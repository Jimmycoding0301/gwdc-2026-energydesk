import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Link2, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert, Wallet } from 'lucide-react';
import { durablyStoreJson, NILE_CHAIN_ID, RECEIPT_METHOD, validatePreparedProcurementEvidence, type PreparedProcurementEvidence } from '../shared/evidence';
import type { ComparisonReport, Plan } from '../shared/types';

type EvidenceStage = 'deploy_required' | 'not_connected' | 'prepared' | 'broadcast_unknown' | 'rechecking' | 'submitted' | 'confirmed' | 'reverted' | 'mismatch';
interface EvidenceConfig { network: string; chainId: string; method: string; registryAddress: string | null; ready: boolean }
type PreparedEvidence = PreparedProcurementEvidence;
interface Verification {
  status: 'pending' | 'confirmed' | 'reverted' | 'mismatch';
  network: string;
  chainId: string;
  txId: string;
  explorerUrl: string;
  receiptHash: string;
  kindHash: string;
  checkedAt: string;
  message: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  feeSun?: number;
  energyUsageTotal?: number;
}
interface TronTransaction {
  [key: string]: unknown;
  txID?: string;
  signature?: string[];
  raw_data?: { fee_limit?: number; contract?: Array<{ type?: string; parameter?: { value?: { owner_address?: string; contract_address?: string; data?: string; call_value?: number; call_token_value?: number } } }> };
}
interface TronWebLike {
  defaultAddress: { base58?: string | false };
  fullNode?: { host?: string };
  address: { fromHex(value: string): string };
  transactionBuilder: {
    triggerSmartContract(address: string, method: string, options: Record<string, unknown>, parameters: Array<{ type: string; value: string }>, owner: string): Promise<{ result?: { result?: boolean; message?: string }; transaction?: TronTransaction }>;
  };
  trx: {
    sign(transaction: TronTransaction): Promise<TronTransaction>;
    sendRawTransaction(transaction: TronTransaction): Promise<{ result?: boolean; code?: string; message?: string; txid?: string; transaction?: TronTransaction }>;
  };
}
interface TronProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  tronWeb: TronWebLike | false;
}
interface SavedEvidence {
  prepared: PreparedEvidence;
  txId: string;
  verification: Verification | null;
  signedTransaction: TronTransaction | null;
  broadcastState: 'none' | 'unknown' | 'submitted';
}
declare global {
  interface Window { tron?: TronProvider; tronLink?: TronProvider; tronWeb?: TronWebLike }
}

function short(value: string, start = 9, end = 7) { return `${value.slice(0, start)}…${value.slice(-end)}`; }
function evidenceStorageKey(reportId: string, planId: string) { return `energydesk:evidence:v1:${reportId}:${planId}`; }
function loadEvidence(report: ComparisonReport, plan: Plan): SavedEvidence | null {
  try {
    const value = JSON.parse(localStorage.getItem(evidenceStorageKey(report.id, plan.id)) || 'null');
    if (!value?.prepared || value.prepared.payload?.report?.snapshotDigest !== report.snapshotDigest || value.prepared.payload?.plan?.id !== plan.id || !/^[a-f0-9]{64}$/.test(value.prepared.receiptHash)) return null;
    const txId = typeof value.txId === 'string' && /^[a-f0-9]{64}$/.test(value.txId) ? value.txId : '';
    const verification = value.verification && ['pending', 'confirmed', 'reverted', 'mismatch'].includes(value.verification.status) ? value.verification as Verification : null;
    const signedTransaction = txId && value.signedTransaction && typeof value.signedTransaction === 'object' ? value.signedTransaction as TronTransaction : null;
    const broadcastState = value.broadcastState === 'unknown' && signedTransaction ? 'unknown' : txId ? 'submitted' : 'none';
    return { prepared: value.prepared as PreparedEvidence, txId, verification, signedTransaction, broadcastState };
  } catch { return null; }
}
function stageFor(saved: SavedEvidence): EvidenceStage {
  return saved.txId ? 'rechecking' : 'prepared';
}
function saveEvidence(report: ComparisonReport, plan: Plan, value: SavedEvidence) {
  durablyStoreJson(localStorage, evidenceStorageKey(report.id, plan.id), value);
}
function parseChainId(value: unknown): string | null {
  if (typeof value === 'string') return value.toLowerCase();
  if (value && typeof value === 'object' && 'chainId' in value && typeof value.chainId === 'string') return value.chainId.toLowerCase();
  return null;
}
function assertReceiptTransaction(tronWeb: TronWebLike, transaction: TronTransaction, prepared: PreparedEvidence, address: string): string {
  const contracts = transaction.raw_data?.contract;
  const value = contracts?.[0]?.parameter?.value;
  if (contracts?.length !== 1 || contracts[0].type !== 'TriggerSmartContract' || !value) throw new Error('待签交易类型异常，已停止签名。');
  if (tronWeb.address.fromHex(value.owner_address || '') !== address || tronWeb.address.fromHex(value.contract_address || '') !== prepared.payload.anchor.registryAddress) throw new Error('待签交易的钱包或 Registry 不匹配，已停止签名。');
  if (Number(value.call_value || 0) !== 0 || Number(value.call_token_value || 0) !== 0) throw new Error('待签交易携带了 TRX 或 TRC-10 token，已停止签名。');
  if (transaction.raw_data?.fee_limit !== 15_000_000) throw new Error('待签交易 feeLimit 不是 15 TRX 上限，已停止签名。');
  if (typeof value.data !== 'string' || value.data.toLowerCase() !== prepared.callData) throw new Error('待签交易的 selector、kind 或 digest 与采购收据不匹配，已停止签名。');
  if (!transaction.txID || !/^[a-fA-F0-9]{64}$/.test(transaction.txID)) throw new Error('待签交易缺少有效 txID。');
  return transaction.txID.toLowerCase();
}
async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers }, signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
async function connectNile(): Promise<{ provider: TronProvider; tronWeb: TronWebLike; address: string }> {
  const provider = window.tron || window.tronLink;
  if (!provider) throw new Error('未检测到 TronLink。请在装有 TronLink 的浏览器打开此页。');
  const modern = Boolean(window.tron);
  await provider.request({ method: modern ? 'eth_requestAccounts' : 'tron_requestAccounts' });
  let chainId: string | null = null;
  try { chainId = parseChainId(await provider.request({ method: 'eth_chainId' })); } catch { /* legacy fallback below */ }
  if (chainId && chainId !== NILE_CHAIN_ID) {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: NILE_CHAIN_ID }] });
    chainId = parseChainId(await provider.request({ method: 'eth_chainId' }));
  }
  const tronWeb = provider.tronWeb || window.tronWeb;
  if (!tronWeb) throw new Error('TronLink 尚未向此页面授权钱包。');
  const host = tronWeb.fullNode?.host?.replace(/\/$/, '').toLowerCase();
  if (chainId !== NILE_CHAIN_ID && host !== 'https://nile.trongrid.io') throw new Error('网络不是 TRON Nile。请在 TronLink 切换到 Nile 后重试。');
  const address = tronWeb.defaultAddress.base58;
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error('TronLink 未返回可用的 TRON 地址。');
  return { provider, tronWeb, address };
}

const labels: Record<EvidenceStage, string> = {
  deploy_required: '等待部署', not_connected: '未连接', prepared: '已准备', broadcast_unknown: '广播待定', rechecking: '正在复核', submitted: '已提交', confirmed: '已确认', reverted: '已回退', mismatch: '不匹配',
};

export default function ChainEvidence({ report, plan, dirty }: { report: ComparisonReport; plan: Plan; dirty: boolean }) {
  const [restored] = useState(() => loadEvidence(report, plan));
  const [config, setConfig] = useState<EvidenceConfig | null>(null);
  const [stage, setStage] = useState<EvidenceStage>(restored ? stageFor(restored) : 'not_connected');
  const [prepared, setPrepared] = useState<PreparedEvidence | null>(restored?.prepared || null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [txId, setTxId] = useState(restored?.txId || '');
  const [signedTransaction, setSignedTransaction] = useState<TronTransaction | null>(restored?.signedTransaction || null);
  const [broadcastState, setBroadcastState] = useState<SavedEvidence['broadcastState']>(restored?.broadcastState || 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checking = useRef(false);
  const pollCount = useRef(0);

  async function loadConfig() {
    try {
      const next = await jsonRequest<EvidenceConfig>('/api/evidence/config');
      setConfig(next); setStage(current => current === 'not_connected' || current === 'deploy_required' ? next.ready ? 'not_connected' : 'deploy_required' : current); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法读取链上凭证配置'); }
  }
  useEffect(() => { void loadConfig(); }, []);
  useEffect(() => {
    const saved = loadEvidence(report, plan);
    if (!saved) {
      setPrepared(null); setVerification(null); setTxId(''); setSignedTransaction(null); setBroadcastState('none'); setError('');
      setStage(config?.ready === false ? 'deploy_required' : 'not_connected'); return;
    }
    setPrepared(saved.prepared); setVerification(null); setTxId(saved.txId); setSignedTransaction(saved.signedTransaction); setBroadcastState(saved.broadcastState); setError(''); setStage(stageFor(saved));
    void (async () => {
      const intact = await validatePreparedProcurementEvidence(saved.prepared).catch(() => false);
      if (!intact) {
        localStorage.removeItem(evidenceStorageKey(report.id, plan.id));
        setPrepared(null); setVerification(null); setTxId(''); setSignedTransaction(null); setBroadcastState('none'); setStage('mismatch'); setError('本地链上收据缓存校验失败，已清除。请重新准备收据。'); return;
      }
      if (!saved.txId) { setStage('prepared'); return; }
      await verify(saved.txId, saved.prepared, saved.broadcastState === 'unknown' ? 'broadcast_unknown' : 'submitted');
    })();
  }, [report.id, plan.id]);
  useEffect(() => {
    if (!prepared || stage === 'rechecking') return;
    try { saveEvidence(report, plan, { prepared, txId, verification, signedTransaction, broadcastState }); } catch { /* A pre-broadcast write is enforced separately. */ }
  }, [prepared, txId, verification, signedTransaction, broadcastState, stage, report.id, plan.id]);

  async function prepare() {
    if (dirty) { setError('表单已经修改，请先重新生成采购计划。'); return; }
    if (!config?.ready) { setStage('deploy_required'); setError('ReceiptRegistry 尚未配置。'); return; }
    setBusy(true); setError('');
    try {
      const { address } = await connectNile();
      const next = await jsonRequest<PreparedEvidence>('/api/evidence/prepare', { method: 'POST', body: JSON.stringify({ reportId: report.id, planId: plan.id, walletAddress: address }) });
      if (next.payload.anchor.registryAddress !== config.registryAddress || next.payload.anchor.chainId !== NILE_CHAIN_ID) throw new Error('服务端返回的链配置与当前配置不一致。');
      if (!await validatePreparedProcurementEvidence(next)) throw new Error('服务端收据的 canonical JSON、哈希或 calldata 不一致。');
      setPrepared(next); setVerification(null); setTxId(''); setSignedTransaction(null); setBroadcastState('none'); setStage('prepared');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法准备链上凭证'); }
    finally { setBusy(false); }
  }

  async function verify(hash = txId, receipt = prepared, pendingStage: 'submitted' | 'broadcast_unknown' = 'submitted'): Promise<Verification | null> {
    if (!hash || !receipt || checking.current) return null;
    checking.current = true;
    try {
      const result = await jsonRequest<Verification>('/api/evidence/verify', { method: 'POST', body: JSON.stringify({ txId: hash, payload: receipt.payload }) });
      setVerification(result);
      if (result.status === 'confirmed') setStage('confirmed');
      else if (result.status === 'reverted') setStage('reverted');
      else if (result.status === 'mismatch') setStage('mismatch');
      else setStage(pendingStage);
      setError('');
      return result;
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Nile 核验暂时失败'); return null; }
    finally { checking.current = false; }
  }

  useEffect(() => {
    if ((stage !== 'submitted' && stage !== 'broadcast_unknown') || !txId || !prepared) return;
    const pendingStage = stage;
    const timer = window.setInterval(() => {
      if (pollCount.current >= 20) { window.clearInterval(timer); return; }
      pollCount.current += 1; void verify(txId, prepared, pendingStage);
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [stage, txId, prepared]);

  async function submit() {
    if (!prepared) return;
    setBusy(true); setError('');
    try {
      if (dirty) throw new Error('表单已经修改，请重新生成计划和收据后再签名。');
      const refreshed = await jsonRequest<PreparedEvidence>('/api/evidence/prepare', { method: 'POST', body: JSON.stringify({ reportId: report.id, planId: plan.id, walletAddress: prepared.payload.anchor.walletAddress }) });
      if (refreshed.canonical !== prepared.canonical || refreshed.receiptHash !== prepared.receiptHash || refreshed.callData !== prepared.callData) throw new Error('本地收据与服务端快照不一致，请重新准备后再签名。');
      setPrepared(refreshed);
      const { tronWeb, address } = await connectNile();
      if (address !== refreshed.payload.anchor.walletAddress) throw new Error('TronLink 已切换账户。请重新准备收据。');
      const wrapper = await tronWeb.transactionBuilder.triggerSmartContract(
        refreshed.payload.anchor.registryAddress,
        RECEIPT_METHOD,
        { callValue: 0, feeLimit: 15_000_000 },
        [{ type: 'bytes32', value: `0x${refreshed.kindHash}` }, { type: 'bytes32', value: `0x${refreshed.receiptHash}` }],
        address,
      );
      if (!wrapper.result?.result || !wrapper.transaction) throw new Error(wrapper.result?.message || 'Nile 节点未能构造 Registry 调用。');
      const unsignedTxId = assertReceiptTransaction(tronWeb, wrapper.transaction, refreshed, address);
      const signed = await tronWeb.trx.sign(wrapper.transaction);
      const signedTxId = assertReceiptTransaction(tronWeb, signed, refreshed, address);
      if (signedTxId !== unsignedTxId) throw new Error('TronLink 返回的 signed txID 与待签交易不一致。');
      if (!signed.signature?.length) throw new Error('TronLink 没有返回完整签名交易。');

      const durable: SavedEvidence = { prepared: refreshed, txId: signedTxId, verification: null, signedTransaction: signed, broadcastState: 'unknown' };
      try { saveEvidence(report, plan, durable); }
      catch { throw new Error('浏览器无法耐久保存签名交易，已在广播前安全停止。'); }
      setPrepared(refreshed); setTxId(signedTxId); setVerification(null); setSignedTransaction(signed); setBroadcastState('unknown'); setStage('broadcast_unknown');
      pollCount.current = 0;
      try {
        const broadcast = await tronWeb.trx.sendRawTransaction(signed);
        const returnedId = broadcast.txid || broadcast.transaction?.txID;
        if (!broadcast.result) throw new Error(broadcast.message || broadcast.code || 'Nile 节点未确认接收交易。');
        if (returnedId && returnedId.toLowerCase() !== signedTxId) throw new Error('广播结果的 txID 与签名交易不一致。');
        const submitted: SavedEvidence = { ...durable, broadcastState: 'submitted' };
        try { saveEvidence(report, plan, submitted); } catch { /* Durable unknown state already contains the exact signed transaction. */ }
        setBroadcastState('submitted'); setStage('submitted');
        await verify(signedTxId, refreshed, 'submitted');
      } catch (broadcastError) {
        const checked = await verify(signedTxId, refreshed, 'broadcast_unknown');
        if (!checked || checked.status === 'pending') setError(`广播结果未知：${broadcastError instanceof Error ? broadcastError.message : '网络异常'}。已保留原 txID 和签名交易；请先核验，再重发同一交易。`);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '签名或广播失败'); }
    finally { setBusy(false); }
  }

  async function retrySameSignedTransaction() {
    if (!prepared || !txId || !signedTransaction) { setError('没有可安全重发的原始签名交易。'); return; }
    setBusy(true); setError('');
    try {
      if (!await validatePreparedProcurementEvidence(prepared)) throw new Error('本地收据完整性校验失败，禁止重发。');
      const checked = await verify(txId, prepared, 'broadcast_unknown');
      if (!checked) throw new Error('查询 Nile 固化节点失败，本次不重发。');
      if (checked.status !== 'pending') return;
      const { tronWeb, address } = await connectNile();
      if (address !== prepared.payload.anchor.walletAddress) throw new Error('当前 TronLink 账户与原签名钱包不一致。');
      const savedTxId = assertReceiptTransaction(tronWeb, signedTransaction, prepared, address);
      if (savedTxId !== txId || !signedTransaction.signature?.length) throw new Error('保存的签名交易与原 txID 不一致，禁止重发。');
      const broadcast = await tronWeb.trx.sendRawTransaction(signedTransaction);
      const returnedId = broadcast.txid || broadcast.transaction?.txID;
      if (!broadcast.result) throw new Error(broadcast.message || broadcast.code || 'Nile 节点未确认接收原交易。');
      if (returnedId && returnedId.toLowerCase() !== txId) throw new Error('重发响应 txID 与原交易不一致。');
      const submitted: SavedEvidence = { prepared, txId, verification: checked, signedTransaction, broadcastState: 'submitted' };
      try { saveEvidence(report, plan, submitted); } catch { /* Existing durable unknown record remains recoverable. */ }
      setBroadcastState('submitted'); setStage('submitted'); setError('');
      await verify(txId, prepared, 'submitted');
    } catch (caught) {
      setStage('broadcast_unknown'); setBroadcastState('unknown');
      setError(caught instanceof Error ? caught.message : '原签名交易重发失败');
    } finally { setBusy(false); }
  }

  function downloadReceipt() {
    if (!prepared) return;
    const body = { payload: prepared.payload, canonical: prepared.canonical, receiptHash: prepared.receiptHash, kindHash: prepared.kindHash, txId: txId || null, verification, exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `energydesk-nile-${txId || prepared.receiptHash}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copyHash() {
    if (!prepared) return;
    try { await navigator.clipboard.writeText(prepared.receiptHash); } catch { setError('浏览器拒绝访问剪贴板，请从下方手动复制哈希。'); }
  }

  return <section id="chain-evidence" className={`chain-evidence stage-${stage}`} aria-labelledby="chain-evidence-title">
    <div className="chain-evidence-head"><div><span className="tiny-label">04 / NILE RECEIPT</span><h2 id="chain-evidence-title">让采购判断，留下链上证据。</h2><p>签名提交收据哈希。供应商不会收到订单。</p></div><span className={`chain-state ${stage}`} aria-live="polite"><i />{labels[stage]}</span></div>
    <div className="chain-steps">
      <div className={prepared ? 'done' : ''}><span>01</span><strong>连接 Nile</strong><small>{prepared ? short(prepared.payload.anchor.walletAddress) : 'TronLink'}</small></div>
      <div className={txId ? 'done' : ''}><span>02</span><strong>提交哈希</strong><small>{txId ? short(txId) : '0 TRX callValue'}</small></div>
      <div className={stage === 'confirmed' ? 'done' : ''}><span>03</span><strong>独立核验</strong><small>{verification?.blockNumber ? `Block ${verification.blockNumber}` : 'Nile RPC'}</small></div>
    </div>

    {stage === 'deploy_required' ? <div className="chain-empty"><TriangleAlert size={21} /><div><strong>ReceiptRegistry 尚未配置</strong><p>先在 Nile 部署共享合约，再设置 <code>NILE_RECEIPT_REGISTRY_ADDRESS</code>。页面不会使用占位地址。</p></div><button type="button" className="button secondary small" onClick={() => void loadConfig()}><RefreshCw size={13} />重新检查</button></div> : <>
      <div className="receipt-preview"><div><span>决策状态</span><strong>已选择 · 未下单</strong></div><div><span>方案</span><strong>{plan.allocations.map(item => `${item.providerId} ${item.energy.toLocaleString('en-US')} E`).join(' + ')}</strong></div><div><span>完整成本</span><strong>{plan.totalSun} SUN</strong></div><div><span>报价到期</span><strong>{new Date(report.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}</strong></div></div>
      {prepared && <div className="hash-row"><ShieldCheck size={16} /><div><span>SHA-256 RECEIPT</span><code>{prepared.receiptHash}</code></div><button type="button" aria-label="复制收据哈希" onClick={() => void copyHash()}><Copy size={14} /></button></div>}
      {txId && <div className="tx-row"><Link2 size={15} /><div><span>交易哈希</span><code>{txId}</code></div><a href={`https://nile.tronscan.org/#/transaction/${txId}`} target="_blank" rel="noreferrer">TRONSCAN <ExternalLink size={12} /></a></div>}
      {stage === 'rechecking' && <div className="verification-note pending"><LoaderCircle className="spin" size={17} /><div><strong>正在重新核验</strong><p>本地“已确认”不会直接恢复。正在重算 canonical JSON、哈希与 calldata，并查询 Nile 固化节点。</p></div></div>}
      {stage === 'broadcast_unknown' && !verification && <div className="verification-note unknown"><TriangleAlert size={17} /><div><strong>广播结果待定</strong><p>原 txID 与完整签名交易已保存。先查原 txID；需要重试时只重发同一份签名数据。</p></div></div>}
      {verification && <div className={`verification-note ${verification.status}`}>{verification.status === 'confirmed' ? <Check size={17} /> : verification.status === 'pending' ? <LoaderCircle className="spin" size={17} /> : <TriangleAlert size={17} />}<div><strong>{verification.status === 'confirmed' ? '固化证据已通过' : verification.status === 'pending' ? stage === 'broadcast_unknown' ? '固化节点暂未找到原交易' : '已广播，等待固化' : verification.status === 'reverted' ? '链上执行失败' : '证据不匹配'}</strong><p>{verification.message}</p></div></div>}
      <div className="chain-actions">{!prepared ? <button type="button" className="button primary" disabled={busy || dirty} onClick={() => void prepare()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Wallet size={16} />}连接并准备收据</button> : !txId ? <button type="button" className="button primary" disabled={busy || dirty} onClick={() => void submit()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}用 TronLink 提交</button> : stage === 'broadcast_unknown' ? <button type="button" className="button secondary" disabled={busy || !signedTransaction} onClick={() => void retrySameSignedTransaction()}><RefreshCw size={15} />查询并重发原交易</button> : stage === 'submitted' ? <button type="button" className="button secondary" disabled={busy} onClick={() => void verify()}><RefreshCw size={15} />核验固化</button> : stage === 'rechecking' ? <button type="button" className="button secondary" disabled={busy} onClick={() => void verify(txId, prepared, broadcastState === 'unknown' ? 'broadcast_unknown' : 'submitted')}><RefreshCw size={15} />再次复核</button> : null}{prepared && <button type="button" className="button secondary" onClick={downloadReceipt}><Download size={15} />下载收据</button>}</div>
    </>}
    {error && <div role="alert" className="chain-error"><TriangleAlert size={15} />{error}</div>}
    <p className="chain-boundary">真实 Nile 合约交易 · callValue 为 0，但可能消耗测试网 Energy、Bandwidth 或测试 TRX。签名后先耐久保存；广播异常只查询或重发同一 txID 的原签名数据。它不购买 Energy，不调用供应商，也不证明资源已经到账。</p>
  </section>;
}
