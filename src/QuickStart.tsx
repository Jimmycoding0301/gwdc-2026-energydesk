import { useState, type ClipboardEvent, type FormEvent } from 'react';
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, LoaderCircle, Search, X } from 'lucide-react';
import { classifyLookup, STARTING_POINTS, type HistoryEnergyDraft, type LookupResult } from '../shared/intake';

export default function QuickStart({ disabled, onAddress, onEnergy }: { disabled: boolean; onAddress: (address: string) => void; onEnergy: (amount: number) => void }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<HistoryEnergyDraft | null>(null);
  const [applied, setApplied] = useState(false);
  const [preset, setPreset] = useState('');
  async function lookup(value: string) {
    if (disabled || busy) return;
    setBusy(true); setError(''); setNotice(''); setDraft(null); setApplied(false); setPreset('');
    try {
      const response = await fetch('/api/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: value }), signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '无法读取输入，请稍后重试。');
      const data = result as LookupResult;
      if (data.kind === 'address') { onAddress(data.address); setNotice(`地址已校验：${data.address}。未询价，未付款。`); }
      else if (data.kind === 'transaction') setDraft(data);
      else throw new Error('查询返回了无法识别的结果。');
    } catch (e) { setError(e instanceof Error ? e.message : '查询失败，未改用演示数据。'); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void lookup(query); }
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const value = event.clipboardData.getData('text').trim();
    if (classifyLookup(value) === 'unknown') return;
    event.preventDefault(); setQuery(value); void lookup(value);
  }
  return <div className="quick-start">
    <form className="universal-search" onSubmit={submit} aria-label="从地址或交易开始">
      <Search size={20} aria-hidden="true" /><input aria-label="TRON 地址或交易哈希" placeholder="工资钱包，或历史 USDT 交易…" value={query} onChange={e => setQuery(e.target.value)} onPaste={paste} spellCheck={false} autoComplete="off" disabled={disabled || busy} maxLength={128} />
      {query && !busy && <button type="button" className="clear-search" onClick={() => { setQuery(''); setDraft(null); setError(''); setNotice(''); setApplied(false); }} aria-label="清除查询"><X size={16} /></button>}
      <button type="submit" className="search-submit" aria-label={busy ? '正在查询' : '识别地址或查询历史能耗'} disabled={disabled || busy || !query.trim()}>{busy ? <LoaderCircle size={20} className="spin" /> : <ArrowRight size={21} />}</button>
    </form>
    <div className="search-hints"><span>地址校验 · 历史能耗</span><span>TRON 主网 / 只读</span></div>
    <div className="quick-presets" aria-label="可编辑的需求起点">{STARTING_POINTS.map(point => <button key={point.id} className={preset === point.id ? 'chosen' : ''} disabled={disabled || busy} onClick={() => { onEnergy(point.energy); setPreset(point.id); setDraft(null); setApplied(false); setError(''); setNotice(point.note); }}><span>{point.label}</span><small>{point.energy.toLocaleString('en-US')} E 起点</small></button>)}</div>
    {notice && <div className="quick-notice" role="status"><Check size={15} /><p>{notice}</p></div>}
    {error && <div className="quick-error" role="alert"><p>{error}</p><button onClick={() => void lookup(query)} disabled={disabled || busy}>重试</button></div>}
    {draft && <section className="history-draft" aria-labelledby="history-title"><div className="history-head"><div><span className="tiny-label">CONFIRMED RECEIPT</span><h2 id="history-title">用上一笔，规划下一笔。</h2></div><a href={draft.explorerUrl} target="_blank" rel="noreferrer" aria-label="在 Tronscan 查看原交易"><ExternalLink size={17} /></a></div><div className="history-numbers"><div><span>实际消耗</span><strong>{draft.energyUsage.toLocaleString('en-US')}<small>Energy</small></strong></div><ArrowRight size={18} /><div><span>起点 · +15%</span><strong>{draft.suggestedEnergy?.toLocaleString('en-US') || '不建议'}<small>{draft.suggestedEnergy === null ? '' : 'Energy'}</small></strong></div></div><p className="history-warning">历史回执不等于链上仿真。</p><div className="history-actions"><span>区块 {draft.blockNumber.toLocaleString('en-US')} · {new Date(draft.blockTimestamp).toLocaleString('zh-CN', { hour12: false })}</span><button className="button primary small" disabled={disabled || draft.suggestedEnergy === null || applied} onClick={() => { if (draft.suggestedEnergy !== null) { onEnergy(draft.suggestedEnergy); setApplied(true); } }}>{applied ? <Check size={14} /> : <Copy size={14} />}{applied ? '已填入' : '填入数量'}</button></div><details><summary>回执与方法 <ChevronDown size={14} /></summary><code>{draft.txId}</code><p>{new Date(draft.fetchedAt).toLocaleString('zh-CN', { hour12: false })} · <a href="https://developers.tron.network/reference/gettransactioninfobyid" target="_blank" rel="noreferrer">TRON 文档 ↗</a></p><code>{draft.sourceUrl}</code><ul>{draft.notes.map(note => <li key={note}>{note}</li>)}</ul></details></section>}
  </div>;
}
