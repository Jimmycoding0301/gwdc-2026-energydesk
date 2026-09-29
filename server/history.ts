import { z } from 'zod';
import { classifyLookup, type LookupResult } from '../shared/intake';
import { validTronAddress } from './validation';
import type { Fetcher } from './providers';

export const RECEIPT_ENDPOINT = 'https://api.trongrid.io/walletsolidity/gettransactioninfobyid';
export class LookupError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const receiptSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{64}$/),
  blockNumber: z.number().int().safe().nonnegative(),
  blockTimeStamp: z.number().int().safe().positive(),
  receipt: z.object({ result: z.string().optional(), energy_usage_total: z.number().int().safe().nonnegative().optional() }),
});
export async function lookupRequest(query: string, fetcher: Fetcher = fetch, now = new Date().toISOString()): Promise<LookupResult> {
  const text = query.trim(), kind = classifyLookup(text);
  if (kind === 'address') {
    if (!validTronAddress(text)) throw new LookupError(400, 'INVALID_ADDRESS', '地址校验和不正确，请完整复制 TRON 地址。');
    return { kind: 'address', address: text };
  }
  if (kind !== 'transaction') throw new LookupError(400, 'INVALID_INPUT', '请粘贴 T 开头的 TRON 地址，或不带 0x 的 64 位交易哈希。');
  const txId = text.toLowerCase();
  let response: Response;
  try {
    response = await fetcher(RECEIPT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: txId }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch { throw new LookupError(502, 'RPC_UNAVAILABLE', 'TronGrid 只读查询失败或超时。未生成能耗建议，也没有改用演示回执。'); }
  if (!response.ok) throw new LookupError(502, 'RPC_HTTP_ERROR', `TronGrid 返回 HTTP ${response.status}；稍后重试，或直接填写 Energy 数量。`);
  let raw: unknown;
  try {
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error();
    raw = JSON.parse(body);
  } catch { throw new LookupError(502, 'INVALID_RECEIPT', '链上回执格式无效，未据此生成建议。'); }
  if (raw && typeof raw === 'object' && Object.keys(raw).length === 0) throw new LookupError(404, 'RECEIPT_NOT_FOUND', '主网已确认节点尚未查到这笔交易；请检查哈希、网络或确认状态。');
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id.toLowerCase() !== txId) throw new LookupError(502, 'INVALID_RECEIPT', '回执字段或交易哈希不一致，未据此生成建议。');
  const data = parsed.data;
  if (data.receipt.result && data.receipt.result !== 'SUCCESS') throw new LookupError(422, 'TRANSACTION_FAILED', '这笔历史交易执行失败，不能作为成功交易的租能参考。');
  if (data.receipt.energy_usage_total === undefined) throw new LookupError(422, 'NO_ENERGY_FIELD', '回执没有 energy_usage_total。普通 TRX 转账通常只使用 Bandwidth；缺失字段不会被当作零能耗。');
  if (data.receipt.result !== 'SUCCESS') throw new LookupError(422, 'RESULT_UNVERIFIED', '回执未提供明确的成功执行状态，不能据此推荐 Energy。');
  const energyUsage = data.receipt.energy_usage_total;
  const suggestion = (BigInt(energyUsage) * 115n + 99n) / 100n;
  const suggestedEnergy = suggestion > 0n && suggestion <= 5_000_000n ? Number(suggestion) : null;
  return { kind: 'transaction', txId, energyUsage, suggestedEnergy, bufferPercent: 15, blockNumber: data.blockNumber, blockTimestamp: data.blockTimeStamp, fetchedAt: now, sourceUrl: RECEIPT_ENDPOINT, explorerUrl: `https://tronscan.org/#/transaction/${txId}`, network: 'mainnet', notes: [
    '只读取主网已确认回执的 receipt.energy_usage_total，不使用交易费用反推能耗。',
    '建议在该次历史能耗上增加 15% 规划余量并向上取整；余量是本工具的假设，无法保证覆盖下次交易。',
    '下一次的合约方法、接收方状态、参数与动态能量系数可能不同。历史交易不自动设置新的 Energy 接收地址。',
    ...(suggestedEnergy === null ? ['建议为零或超出本工具 5,000,000 E 上限；没有截断或自动填入。'] : []),
  ] };
}
