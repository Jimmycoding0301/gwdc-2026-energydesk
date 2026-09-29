import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine, ArrowRight, Calculator, CalendarClock, Check, ChevronDown,
  CircleHelp, Clock3, ExternalLink, FlaskConical, Layers3, LoaderCircle,
  RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, TriangleAlert,
  UsersRound, Wallet, Zap,
} from 'lucide-react';
import type { ComparisonReport, Duration, Mode, Plan, ProcurementRequest, ProviderQuote } from '../shared/types';
import { formatTrx, trxToSun } from '../shared/money';
import QuickStart from './QuickStart';
import BriefCopy from './BriefCopy';
import ChainEvidence from './ChainEvidence';

const WORKERS = 86;
const number = (value: number) => value.toLocaleString('en-US');
const localDate = (time: number) => {
  const date = new Date(time);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const stamp = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const label = (id: string) => id === 'justlend' ? 'JustLend' : 'TronEnergyRent';
const REPORT_STORAGE_KEY = 'energydesk:last-report:v1';

function savedReport(): { report: ComparisonReport; selected: string | null } | null {
  try {
    const value = JSON.parse(localStorage.getItem(REPORT_STORAGE_KEY) || 'null');
    if (!value || typeof value !== 'object' || !value.report || typeof value.report.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.report.snapshotDigest) || !Array.isArray(value.report.quotes)) return null;
    return { report: value.report as ComparisonReport, selected: typeof value.selected === 'string' ? value.selected : null };
  } catch { return null; }
}

async function api<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败，请稍后重试');
  return result;
}

function Download({ report, selected }: { report: ComparisonReport; selected: string | null }) {
  function download() {
    const content = { ...report, selectedPlanId: selected, exportedAt: new Date().toISOString(), notice: '只读采购比较；无订单、无付款、无锁价。' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `energydesk-${report.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <button className="button secondary small" onClick={download}><ArrowDownToLine size={15} /> 导出证据</button>;
}

function ProviderCard({ quote }: { quote: ProviderQuote }) {
  const ready = quote.status === 'ready';
  return <article className={`provider-card ${!ready ? 'unavailable' : ''}`}>
    <div className="provider-head">
      <span className={`provider-logo ${quote.id}`}>{quote.id === 'justlend' ? 'J' : <Zap size={21} />}</span>
      <div><h3>{quote.name}</h3><span className={`status ${ready ? 'good' : 'bad'}`}><i />{quote.mode === 'fixture' ? '演示参数' : ready ? '公开接口' : quote.status === 'unsupported' ? '期限不支持' : '来源不可用'}</span></div>
      <a href={quote.docsUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${quote.name} 官方文档`}><ExternalLink size={16} /></a>
    </div>
    {ready ? <>
      <div className="unit-price"><strong>{quote.unitPriceSun}</strong><span>SUN / Energy</span><small>{formatTrx((BigInt(quote.unitPriceSun) * 10_000n).toString())} TRX / 万 E</small></div>
      <dl className="quote-details">
        <div><dt>库存</dt><dd>{number(quote.availableEnergy)} <small>E</small></dd></div><div><dt>最低购买</dt><dd>{number(quote.minEnergy)} <small>E</small></dd></div>
        <div><dt>单笔上限</dt><dd>{number(quote.maxEnergy)} <small>E</small></dd></div><div><dt>期限</dt><dd>{quote.duration}</dd></div>
        <div><dt>交付</dt><dd>{quote.deliverySeconds} 秒 {quote.id === 'justlend' && <em>假设</em>}</dd></div><div><dt>激活费</dt><dd>{formatTrx(quote.activationSun)} TRX</dd></div>
      </dl>
    </> : <div className="source-error"><TriangleAlert size={20} /><p>{quote.error}</p></div>}
    <details><summary>方法与原始证据 <ChevronDown size={14} /></summary><div className="source-notes"><p>{quote.method}</p><p>{quote.deliveryBasis}</p><p>{quote.feeBasis}</p>{quote.notes.map(note => <p key={note}>{note}</p>)}<a href={quote.sourceUrl} target="_blank" rel="noreferrer">数据来源 <ExternalLink size={12} /></a><pre>{JSON.stringify(quote.evidence, null, 2)}</pre></div></details>
    <div className="card-foot"><Clock3 size={12} /> {stamp(quote.fetchedAt)}<span>{quote.mode === 'fixture' ? 'DEMO' : 'MAINNET DATA'}</span></div>
  </article>;
}

function PlanCard({ plan, title, active, onSelect }: { plan: Plan | null; title: string; active: boolean; onSelect: () => void }) {
  return <button type="button" className={`plan-option ${active ? 'active' : ''}`} disabled={!plan} onClick={onSelect} aria-pressed={active}>
    <span className="plan-option-title">{title}{active && <Check size={15} />}</span><strong>{plan ? formatTrx(plan.totalSun) : '—'} <small>TRX</small></strong><span className="plan-option-caption">{plan ? plan.allocations.map(part => label(part.providerId)).join(' + ') : '库存不足'}</span>
  </button>;
}

export default function App() {
  const [restored] = useState(savedReport);
  const [mode, setMode] = useState<Mode>('fixture');
  const [energy, setEnergy] = useState('5590000');
  const [duration, setDuration] = useState<Duration>('1h');
  const [recipient, setRecipientValue] = useState('TJRabPrwbZy45sbavfcjinPJC18kjpRTv8');
  const [recipientActivated, setRecipientActivated] = useState(true);
  const [budget, setBudget] = useState('260');
  const [eventEnd, setEventEnd] = useState(() => localDate(Date.now() + 15 * 60_000));
  const [deadline, setDeadline] = useState(() => localDate(Date.now() + 45 * 60_000));
  const [payouts, setPayouts] = useState('86');
  const [energyPerPayout, setEnergyPerPayout] = useState('65000');
  const [chain, setChain] = useState('0.3');
  const [other, setOther] = useState('0');
  const [delivery, setDelivery] = useState('60');
  const [report, setReport] = useState<ComparisonReport | null>(restored?.report || null);
  const [selected, setSelected] = useState<string | null>(restored?.selected || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    try {
      if (report) localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify({ report, selected }));
      else localStorage.removeItem(REPORT_STORAGE_KEY);
    } catch { /* Storage can be unavailable in private browser contexts. */ }
  }, [report, selected]);

  const payoutCount = Number(payouts);
  const perPayout = Number(energyPerPayout);
  const plannedEnergy = Number.isSafeInteger(payoutCount) && Number.isSafeInteger(perPayout) ? payoutCount * perPayout : 0;
  const closingWindowMinutes = Math.round((Date.parse(deadline) - Date.parse(eventEnd)) / 60_000);
  const closingWindow = Number.isFinite(closingWindowMinutes) ? String(Math.max(0, closingWindowMinutes)) : '—';
  const expired = Boolean(report && now >= Date.parse(report.expiresAt));
  const plans = report ? [report.recommended, report.bestSingle, report.bestSplit, ...report.alternatives] : [];
  const picked = plans.find(plan => plan?.id === selected) || report?.recommended || null;
  const savings = report?.bestSingle && report.recommended ? BigInt(report.bestSingle.totalSun) - BigInt(report.recommended.totalSun) : 0n;
  const readyCount = report?.quotes.filter(quote => quote.status === 'ready').length || 0;
  const closingReport = report?.input.scenario;

  function setRecipient(value: string) { if (value.trim() !== recipient.trim()) setRecipientActivated(false); setRecipientValue(value); }
  function validateClosingRun() {
    if (!Number.isSafeInteger(payoutCount) || payoutCount < 1 || payoutCount > 500) throw new Error('付款笔数应为 1–500 的整数。');
    if (!Number.isSafeInteger(perPayout) || perPayout < 1 || perPayout > 300_000) throw new Error('单笔 Energy 规划值应为 1–300,000。');
    if (plannedEnergy > 10_000_000) throw new Error('总需求超过本工具 10,000,000 Energy 的比较上限。');
    if (!Number.isFinite(Date.parse(eventEnd)) || !Number.isFinite(Date.parse(deadline)) || Date.parse(eventEnd) >= Date.parse(deadline)) throw new Error('付款截止时间必须晚于活动结束时间。');
  }
  function applyClosingRun() {
    try { validateClosingRun(); setEnergy(String(plannedEnergy)); setMode('fixture'); setReport(null); setSelected(null); setDirty(false); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '关账参数无效'); }
  }
  async function compare(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError('');
    try {
      validateClosingRun();
      if (Number(energy) === 0) throw new Error('该需求不需要 Energy。');
      const input: ProcurementRequest = {
        energy: Number(energy), duration, recipient: recipient.trim(), recipientActivated, budgetSun: trxToSun(budget), deadline: new Date(deadline).toISOString(), chainFeeReserveSun: trxToSun(chain), otherReserveSun: trxToSun(other), justlendDeliverySeconds: Number(delivery), mode, fixtureRevision: 1,
        scenario: { id: 'seoul-event-close', eventName: 'Seoul Creator Week · Closing Run', workerCount: WORKERS, payoutCount, plannedEnergyPerPayout: perPayout, eventEndsAt: new Date(eventEnd).toISOString() },
      };
      const next = await api<ComparisonReport>('/api/compare', input);
      setReport(next); setSelected(null); setDirty(false); setNow(Date.now());
    } catch (caught) { setError(caught instanceof Error ? caught.message : '未能取得报价'); }
    finally { setBusy(false); }
  }
  async function recheck(changeFixture = false) {
    if (!report) return;
    setBusy(true); setError('');
    try {
      const next = await api<ComparisonReport>('/api/recheck', { reportId: report.id, planId: picked?.id, ...(changeFixture ? { fixtureRevision: 2 } : {}) });
      setReport(next); setSelected(null); setNow(Date.now());
    } catch (caught) { setError(caught instanceof Error ? caught.message : '重新询价失败'); }
    finally { setBusy(false); }
  }
  function changeMode(next: Mode) { setMode(next); setReport(null); setSelected(null); setDirty(false); setError(''); }

  return <div className="app-shell">
    <div className="announcement"><span>86 people. 30 minutes. One closing run.</span><span>TRON Energy · 只读采购规划 <ArrowRight size={12} /></span></div>
    <header className="topbar"><a href="#main" className="wordmark">Energy<span>Desk</span></a><nav aria-label="项目导航"><a href="#closing-run">关账任务</a><a href="#request-title">采购计划</a><a href={report ? '#chain-evidence' : '#source-intro'}>链上凭证</a></nav><a className="nav-cta" href="#closing-run">开始规划 <ArrowRight size={14} /></a></header>
    <main id="main">
      <section className="hero">
        <span className="hero-badge"><span className="live-dot" /> SEOUL CREATOR WEEK <i>·</i> 86 人待付</span>
        <p className="eyebrow">CLOSE THE EVENT. PAY THE PEOPLE.</p><h1>散场前，把工资付完。</h1>
        <p className="hero-description">86 笔工资与报销已就绪。<br className="mobile-break" />先让 Energy 在截止时间前到位。</p>
        <a className="button primary hero-cta" href="#closing-run">设置 86 笔付款 <ArrowRight size={17} /></a>
        <div className="hero-bottom"><span>Count it.</span><span>Split it.</span><span>Recheck it.</span></div>
      </section>
      <div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">THE CLOSING RUN</p><h2>一场活动，一个付款窗口。</h2></div><div className="mode-switch" aria-label="报价数据模式"><button className={mode === 'fixture' ? 'active' : ''} onClick={() => changeMode('fixture')} disabled={busy} aria-pressed={mode === 'fixture'}><FlaskConical size={14} />路演演练</button><button className={mode === 'live' ? 'active' : ''} onClick={() => changeMode('live')} disabled={busy} aria-pressed={mode === 'live'}><span className="live-dot" />实时来源</button></div></div>

        <section id="closing-run" className="closing-run" aria-labelledby="closing-title">
          <div className="closing-copy"><span className="tiny-label">SEOUL CREATOR WEEK · FINAL PAYOUT</span><h2 id="closing-title">86 位工作人员，一次关账。</h2><p>摄影、翻译、主持与志愿者的 USDT 工资和报销已合并。</p><div className="closing-facts"><span><UsersRound size={15} /><strong>{WORKERS}</strong> 人</span><span><Wallet size={15} /><strong>{payoutCount || '—'}</strong> 笔</span><span><CalendarClock size={15} /><strong>{closingWindow}</strong> 分钟窗口</span></div></div>
          <div className="closing-controls"><label>活动结束<input type="datetime-local" value={eventEnd} onChange={event => { setEventEnd(event.target.value); setDirty(true); }} /></label><label>付款截止<input type="datetime-local" value={deadline} onChange={event => { setDeadline(event.target.value); setDirty(true); }} /></label><label>付款笔数<input type="number" min="1" max="500" value={payouts} onChange={event => { setPayouts(event.target.value); setDirty(true); }} /></label><label>单笔规划值<div className="input-affix"><input type="number" min="1" max="300000" value={energyPerPayout} onChange={event => { setEnergyPerPayout(event.target.value); setDirty(true); }} /><span>E</span></div></label><div className="closing-total"><span>规划需求</span><strong>{plannedEnergy ? number(plannedEnergy) : '—'} <small>Energy</small></strong><em>{payoutCount || 0} × {number(perPayout || 0)}</em></div><button type="button" className="button primary" onClick={applyClosingRun} disabled={busy}><Calculator size={17} />填入采购需求</button></div>
          <small className="closing-boundary">65,000 E/笔是可编辑规划值，不是链上仿真。</small>
        </section>

        <details className="wallet-intake"><summary><span><Zap size={14} /> 工资钱包 / 历史交易</span><small>可选</small><ChevronDown size={14} /></summary><QuickStart disabled={busy} onAddress={address => { setRecipient(address); setDirty(true); }} onEnergy={amount => { setEnergy(String(amount)); setDirty(true); setError(''); }} /></details>

        <div className={`notice ${mode === 'fixture' ? 'demo' : 'success'}`}>{mode === 'fixture' ? <FlaskConical size={17} /> : <Check size={17} />}<span>{mode === 'fixture' ? <><strong>DEMO</strong> · 库存与价格为本地演示参数。</> : <><strong>LIVE</strong> · 读取公开报价，不下单。</>}</span></div>

        <section className="request-panel" aria-labelledby="request-title"><div className="section-title"><h2 id="request-title"><span className="step-number">01</span> 设定采购约束</h2><span className="muted">数量 · 预算 · 截止时间</span></div><form onSubmit={compare} onChange={() => setDirty(true)}><fieldset disabled={busy}>
          <div className="input-grid"><label>Energy 数量<div className="input-affix"><input required type="number" min="1" max="10000000" step="1" value={energy} onChange={event => setEnergy(event.target.value)} /><span>E</span></div></label><label>租赁时长<select value={duration} onChange={event => setDuration(event.target.value as Duration)}><option value="1h">1 小时</option><option value="1d">1 天</option><option value="3d">3 天</option><option value="30d">30 天</option></select></label><label>总预算<div className="input-affix"><input required inputMode="decimal" value={budget} onChange={event => setBudget(event.target.value)} /><span>TRX</span></div></label><label>最迟到达<input required type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /></label></div>
          <div className="address-row"><label className="recipient-label">付款钱包<input required spellCheck={false} autoComplete="off" value={recipient} onChange={event => setRecipient(event.target.value)} aria-describedby="recipient-hint" /></label><button type="submit" className="button primary">{busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}{busy ? '正在比较…' : mode === 'live' ? '获取实时计划' : '生成关账计划'}{!busy && <ArrowRight size={17} />}</button></div>
          <div className="request-meta"><label className="checkbox"><input type="checkbox" checked={recipientActivated} onChange={event => setRecipientActivated(event.target.checked)} /> 地址已激活</label><span id="recipient-hint">实时询价会把此地址发给 JustLend 报价服务。</span></div>
          <details className="advanced"><summary><SlidersHorizontal size={14} /> 费用预留 <ChevronDown size={14} /></summary><div className="advanced-grid"><label>每单链上预留 / TRX<input inputMode="decimal" value={chain} onChange={event => setChain(event.target.value)} /></label><label>每单其他预留 / TRX<input inputMode="decimal" value={other} onChange={event => setOther(event.target.value)} /></label><label>JustLend 交付假设 / 秒<input type="number" min="1" max="3600" value={delivery} onChange={event => setDelivery(event.target.value)} /></label></div><p>拆单会多计一份预留。预留和交付时间均可编辑。</p></details>
        </fieldset></form></section>

        {error && <div role="alert" className="notice warning"><TriangleAlert size={18} /><span>{error}</span></div>}
        {report && dirty && <div className="notice warning"><TriangleAlert size={18} /><span>条件已改。请重新生成计划。</span></div>}
        {report && expired && !dirty && <div className="notice warning quote-expired"><TriangleAlert size={18} /><div><strong>红灯 · 报价已过期</strong><p>库存没有锁定。重新询价后再采购。</p></div><button className="button secondary small" onClick={() => recheck()} disabled={busy}><RefreshCw size={14} />重新规划</button></div>}
        <div aria-live="polite" className="sr-only">{busy ? '正在获取并比较报价' : report ? `已比较 ${report.search.examined} 个候选，${report.search.feasible} 个可行` : ''}</div>

        {!report ? <section id="source-intro" className="empty-state"><div className="empty-visual"><div className="empty-source"><Zap size={22} /><span>TronEnergyRent</span></div><span className="join-line" /><div className="empty-hub"><Layers3 size={25} /></div><span className="join-line" /><div className="empty-source justlend"><span className="j-icon">J</span><span>JustLend</span></div></div><h2>单家不够，就拆。</h2><p>同时检查库存、总价和交付时间。</p><div id="method-intro" className="empty-facts"><span><Check size={14} /> 整数 SUN</span><span><Check size={14} /> 单家 / 拆单</span><span><Check size={14} /> 过期重算</span></div></section> : <>
          <section className="results-bar"><div><span className={`status ${expired ? 'bad' : 'good'}`}><i />{expired ? '报价过期' : report.input.mode === 'fixture' ? 'DEMO 快照' : 'LIVE 快照'}</span><span className="snapshot-time">{stamp(report.createdAt)} · {readyCount}/2 来源 · {expired ? '等待重算' : `${Math.max(0, Math.ceil((Date.parse(report.expiresAt) - now) / 1000))} 秒有效`}</span></div><div className="result-actions"><BriefCopy report={report} selected={picked?.id || null} dirty={dirty} /><Download report={report} selected={selected} /><button className="button secondary small" onClick={() => recheck()} disabled={busy || dirty}><RefreshCw size={14} className={busy ? 'spin' : ''} />重新询价</button></div></section>
          {report.recheck && <div className={`notice ${report.recheck.status === 'unchanged' ? 'success' : 'warning'}`} role="status">{report.recheck.status === 'unchanged' ? <Check size={19} /> : <TriangleAlert size={19} />}<div><strong>{report.recheck.status === 'invalid' ? '红灯 · 旧计划失效，已重新规划' : report.recheck.status === 'changed' ? '报价已变' : '计划仍可行'}</strong><p>{report.recheck.reasons.join('；')}</p>{report.recheck.previousTotalSun && <small>{formatTrx(report.recheck.previousTotalSun)} TRX → {report.recheck.currentTotalSun ? `${formatTrx(report.recheck.currentTotalSun)} TRX` : '旧分配不可行'}</small>}</div></div>}

          <div className="decision-grid"><section className="recommendation"><div className="recommendation-top"><span className="tiny-label">02 / CLOSING DECISION</span><span className="pill">{report.recommended ? '可执行' : '未通过'}</span></div>{picked ? <><div className="recommendation-heading"><div><h2>{picked.kind === 'split' ? '单家不够，拆开买。' : '一家就够。'}</h2><p>{picked.kind === 'split' ? '两家并行交付，覆盖全部需求。' : '当前库存可覆盖全部需求。'}</p></div><span className="recommendation-symbol"><Zap size={31} /></span></div><div className="total-price"><strong>{formatTrx(picked.totalSun)}</strong><span>TRX<small>含全部预留</small></span></div><div className="recommendation-stats"><div><span>{closingReport ? '覆盖付款' : '与最佳单家相比'}</span><strong>{closingReport ? `${closingReport.payoutCount}/${closingReport.payoutCount} 笔` : savings > 0n && picked.id === report.recommended?.id ? `省 ${formatTrx(savings.toString())} TRX` : '当前最优'}</strong></div><div><span>预算剩余</span><strong>{formatTrx(picked.budgetHeadroomSun)} TRX</strong></div><div><span>交付估计</span><strong>{picked.estimatedDeliverySeconds} 秒 <small>含假设</small></strong></div></div><div className="allocation-bar" aria-label="Energy 分配比例">{picked.allocations.map(part => <div key={part.providerId} className={part.providerId} style={{ width: `${part.energy / report.input.energy * 100}%` }} />)}</div><div className="allocation-labels">{picked.allocations.map(part => <span key={part.providerId}><i className={part.providerId} /><strong>{label(part.providerId)}</strong>{number(part.energy)} E</span>)}</div><div className="recommendation-bottom"><span><ShieldCheck size={14} /> 只读规划 · 未付款</span><span>{report.input.mode === 'fixture' ? 'DEMO' : 'LIVE SOURCES'}</span></div></> : <div className="no-solution"><TriangleAlert size={35} /><h2>当前无法完成关账。</h2><ul>{report.noSolutionReasons.slice(0, 6).map(reason => <li key={reason}>{reason}</li>)}</ul><p>调整预算、数量或截止时间。</p></div>}</section>
            <section className="cost-panel"><div className="section-title"><h2><Wallet size={18} /> 全部费用</h2></div>{picked ? <><div className="cost-total"><span>预算使用</span><strong>{formatTrx(picked.totalSun)} <span>/ {formatTrx(report.input.budgetSun)} TRX</span></strong></div><div className="budget-bar"><div style={{ width: `${Math.min(100, Number(BigInt(picked.totalSun) * 10000n / BigInt(report.input.budgetSun)) / 100)}%` }} /></div><dl className="cost-lines"><div><dt>Energy</dt><dd>{formatTrx(picked.rentalSun)} TRX</dd></div><div><dt>服务费</dt><dd>{formatTrx(picked.serviceSun)} TRX</dd></div><div><dt>激活费</dt><dd>{formatTrx(picked.activationSun)} TRX</dd></div><div><dt>链上预留 <small>× {picked.allocations.length}</small></dt><dd>{formatTrx(picked.chainReserveSun)} TRX</dd></div><div><dt>其他预留 <small>× {picked.allocations.length}</small></dt><dd>{formatTrx(picked.otherReserveSun)} TRX</dd></div></dl><div className="cost-disclaimer"><CircleHelp size={15} /><span>预留不是实测手续费。</span></div></> : <p className="muted">没有通过全部约束的方案。</p>}</section></div>

          <section className="comparison-section"><div className="section-title"><h2>库存先行。</h2><span className="muted">点击切换方案</span></div><div className="plan-options"><PlanCard title="单家方案" plan={report.bestSingle} active={picked?.id === report.bestSingle?.id} onSelect={() => setSelected(report.bestSingle?.id || null)} /><PlanCard title="拆单方案" plan={report.bestSplit} active={picked?.id === report.bestSplit?.id} onSelect={() => setSelected(report.bestSplit?.id || null)} /><div className="search-card"><span className="tiny-label">SEARCH</span><strong>{number(report.search.examined)}<span>候选</span></strong><p>{number(report.search.feasible)} 个可行</p></div></div>{report.input.mode === 'fixture' && <div className="demo-action"><span>下一幕：报价过期，便宜来源库存下降。</span><button className="button secondary small" disabled={busy || dirty || report.input.fixtureRevision === 2} onClick={() => recheck(true)}><FlaskConical size={14} />{report.input.fixtureRevision === 2 ? '已重新规划' : '模拟过期并重新规划'}</button></div>}</section>
          {picked && <ChainEvidence report={report} plan={picked} dirty={dirty} />}
          <section id="sources" className="sources-section"><div className="section-title"><h2><span className="step-number">03</span> 报价证据</h2><span className="muted">1 TRX = 1,000,000 SUN</span></div><div className="provider-grid">{report.quotes.map(quote => <ProviderCard key={quote.id} quote={quote} />)}</div></section>
          <section id="method" className="method-panel"><div className="section-title"><h2><ShieldCheck size={19} /> 为什么是这个方案？</h2><span className="pill neutral">可复算</span></div><p>{report.search.scope}</p><div className="rejection-tags"><span>超预算 {report.search.rejected.budget}</span><span>库存不足 {report.search.rejected.capacity}</span><span>低于最小单 {report.search.rejected.minimum}</span><span>超时 {report.search.rejected.deadline}</span><span>来源不可用 {report.search.rejected.source}</span></div>{report.rejectedExamples.length > 0 && <details><summary>查看被拒方案 <ChevronDown size={14} /></summary><ul className="rejected-list">{report.rejectedExamples.map(plan => <li key={plan.id}><strong>{plan.allocations.map(part => `${label(part.providerId)} ${number(part.energy)} E`).join(' + ')}</strong><span>{plan.reasons.join('；')}</span></li>)}</ul></details>}<details><summary>假设与边界 <ChevronDown size={14} /></summary><ul className="assumptions">{report.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul></details><div className="digest">快照 <code>{report.snapshotDigest}</code></div></section>
        </>}
        <footer><span><Zap size={13} /> EnergyDesk</span><p>让资源先到，让工资按时到。</p><span>GWDC 2026 · TRON Track A</span></footer>
      </div>
    </main>
  </div>;
}
