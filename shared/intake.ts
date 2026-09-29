export interface HistoryEnergyDraft {
  kind: 'transaction';
  txId: string;
  energyUsage: number;
  suggestedEnergy: number | null;
  bufferPercent: 15;
  blockNumber: number;
  blockTimestamp: number;
  fetchedAt: string;
  sourceUrl: string;
  explorerUrl: string;
  network: 'mainnet';
  notes: string[];
}
export type LookupResult = { kind: 'address'; address: string } | HistoryEnergyDraft;
export function classifyLookup(value: string): 'address' | 'transaction' | 'unknown' {
  const text = value.trim();
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(text)) return 'address';
  if (/^[0-9a-fA-F]{64}$/.test(text)) return 'transaction';
  return 'unknown';
}
export const STARTING_POINTS = [
  { id: 'trx', label: '普通 TRX 转账', energy: 0, note: '普通 TRX 转账使用 Bandwidth，通常不需要 Energy。这个起点不会发起租能询价；合约转账请选择其他场景。' },
  { id: 'usdt', label: 'USDT 转账', energy: 65000, note: '65,000 E 只是可编辑起点，不是对这笔交易的链上估算。接收方状态、合约参数和动态能耗会改变实际需要。' },
  { id: 'usdt-new', label: 'USDT · 新收款方', energy: 130000, note: '130,000 E 只是新收款方场景的规划起点，不保证足额。最好粘贴相似历史交易，或按合约模拟结果调整。' },
  { id: 'contract', label: '合约调用', energy: 150000, note: '150,000 E 是手动规划起点，与具体合约无关；不是模拟执行结果。请根据历史回执或合约估算调整。' },
] as const;
