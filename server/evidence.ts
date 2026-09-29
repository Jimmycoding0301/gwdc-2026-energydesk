import { createHash } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3';
import { z } from 'zod';
import { canonicalJson, NILE_CHAIN_ID, NILE_NETWORK, RECEIPT_KIND, RECEIPT_METHOD, RECEIPT_SELECTOR, type PreparedProcurementEvidence, type ProcurementEvidencePayload } from '../shared/evidence';
import { tronAddressToHex, validTronAddress } from './validation';
import type { Fetcher } from './providers';

export const NILE_SOLID_TRANSACTION_ENDPOINT = 'https://nile.trongrid.io/walletsolidity/gettransactionbyid';
export const NILE_SOLID_RECEIPT_ENDPOINT = 'https://nile.trongrid.io/walletsolidity/gettransactioninfobyid';
export const NILE_EXPLORER = 'https://nile.tronscan.org/#/transaction/';
export const RECEIPT_EVENT = 'ReceiptCommitted(address,bytes32,bytes32,uint256)';

export type EvidenceVerificationStatus = 'pending' | 'confirmed' | 'reverted' | 'mismatch';

export interface EvidenceVerification {
  status: EvidenceVerificationStatus;
  network: typeof NILE_NETWORK;
  chainId: typeof NILE_CHAIN_ID;
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
  observed?: {
    ownerAddressHex?: string;
    contractAddressHex?: string;
    callValueSun?: string;
    callTokenValueSun?: string;
    feeLimitSun?: string;
    input?: string;
    contractRet?: string;
    eventFound?: boolean;
  };
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function keccakHex(value: string): string {
  return Buffer.from(keccak_256(new TextEncoder().encode(value))).toString('hex');
}

export function receiptKindHash(): string { return sha256Hex(RECEIPT_KIND); }
export function receiptEventTopic(): string { return keccakHex(RECEIPT_EVENT); }
export function receiptCallData(receiptHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(receiptHash)) throw new Error('收据哈希格式无效');
  const selector = keccakHex(RECEIPT_METHOD).slice(0, 8);
  if (selector !== RECEIPT_SELECTOR) throw new Error('ReceiptRegistry selector 常量不一致');
  return `${selector}${receiptKindHash()}${receiptHash}`;
}

export function prepareProcurementEvidence(payload: ProcurementEvidencePayload): PreparedProcurementEvidence {
  const canonical = canonicalJson(payload);
  const receiptHash = sha256Hex(canonical);
  return { payload, canonical, receiptHash, kindHash: receiptKindHash(), method: RECEIPT_METHOD, callData: receiptCallData(receiptHash) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function readString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] as string : undefined;
}
function normalizedHex(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-fA-F0-9]+$/.test(value) ? value.toLowerCase() : undefined;
}
function uintString(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;
}

async function readNodeJson(fetcher: Fetcher, url: string, txId: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: txId, visible: false }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch { throw new Error('Nile RPC 暂时不可用，请保留原交易哈希后重试。'); }
  if (!response.ok) throw new Error(`Nile RPC 返回 HTTP ${response.status}，请稍后重试。`);
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('Nile RPC 返回了无法解析的数据。'); }
  if (!isRecord(value)) throw new Error('Nile RPC 返回格式无效。');
  if (typeof value.Error === 'string') throw new Error(`Nile RPC：${value.Error}`);
  return value;
}

export async function verifyNileEvidence(txId: string, payload: ProcurementEvidencePayload, fetcher: Fetcher = fetch, checkedAt = new Date().toISOString()): Promise<EvidenceVerification> {
  const receiptHash = sha256Hex(canonicalJson(payload));
  const kindHash = receiptKindHash();
  const base = { network: NILE_NETWORK, chainId: NILE_CHAIN_ID, txId, explorerUrl: `${NILE_EXPLORER}${txId}`, receiptHash, kindHash, checkedAt } as const;
  const [transaction, receipt] = await Promise.all([
    readNodeJson(fetcher, NILE_SOLID_TRANSACTION_ENDPOINT, txId),
    readNodeJson(fetcher, NILE_SOLID_RECEIPT_ENDPOINT, txId),
  ]);
  if (Object.keys(transaction).length === 0 || Object.keys(receipt).length === 0) return { ...base, status: 'pending', message: '交易尚未在 Nile 固化节点同时出现。继续核验原 txID，不生成替代哈希。' };

  const rawData = isRecord(transaction.raw_data) ? transaction.raw_data : undefined;
  const contracts = rawData && Array.isArray(rawData.contract) ? rawData.contract : [];
  const contract = contracts.length === 1 && isRecord(contracts[0]) ? contracts[0] : undefined;
  const parameter = contract && isRecord(contract.parameter) ? contract.parameter : undefined;
  const value = parameter && isRecord(parameter.value) ? parameter.value : undefined;
  const ret = Array.isArray(transaction.ret) && isRecord(transaction.ret[0]) ? transaction.ret[0] : undefined;
  const contractRet = ret ? readString(ret, 'contractRet') : undefined;
  const ownerAddressHex = value ? normalizedHex(value.owner_address) : undefined;
  const contractAddressHex = value ? normalizedHex(value.contract_address) : undefined;
  const callValueSun = value ? uintString(value.call_value) || '0' : undefined;
  const callTokenValueSun = value ? uintString(value.call_token_value) || '0' : undefined;
  const feeLimitSun = rawData ? uintString(rawData.fee_limit) : undefined;
  const input = value ? normalizedHex(value.data) : undefined;
  const expectedOwner = tronAddressToHex(payload.anchor.walletAddress).toLowerCase();
  const expectedContract = tronAddressToHex(payload.anchor.registryAddress).toLowerCase();
  const expectedInput = receiptCallData(receiptHash);

  const expectedEventTopic = receiptEventTopic();
  const expectedSubmitterTopic = expectedOwner.slice(2).padStart(64, '0');
  const expectedContractLogAddress = expectedContract.slice(2);
  const logs = Array.isArray(receipt.log) ? receipt.log : [];
  const eventFound = logs.some(logValue => {
    if (!isRecord(logValue) || normalizedHex(logValue.address) !== expectedContractLogAddress || !Array.isArray(logValue.topics)) return false;
    const topics = logValue.topics.map(normalizedHex);
    const data = normalizedHex(logValue.data);
    return topics[0] === expectedEventTopic && topics[1] === expectedSubmitterTopic && topics[2] === kindHash && Boolean(data?.startsWith(receiptHash) && data.length === 128 && BigInt(`0x${data.slice(64)}`) > 0n);
  });
  const observed = { ownerAddressHex, contractAddressHex, callValueSun, callTokenValueSun, feeLimitSun, input, contractRet, eventFound };

  const mismatches: string[] = [];
  if (readString(transaction, 'txID')?.toLowerCase() !== txId) mismatches.push('交易本体 txID 不匹配');
  if (readString(receipt, 'id')?.toLowerCase() !== txId) mismatches.push('执行回执 txID 不匹配');
  if (contract?.type !== 'TriggerSmartContract') mismatches.push('交易不是 ReceiptRegistry 合约调用');
  if (ownerAddressHex !== expectedOwner) mismatches.push('签名钱包与收据不匹配');
  if (contractAddressHex !== expectedContract) mismatches.push('调用的 Registry 地址不匹配');
  if (callValueSun !== '0') mismatches.push('合约调用携带了 TRX');
  if (callTokenValueSun !== '0') mismatches.push('合约调用携带了 TRC-10 token');
  if (!feeLimitSun || BigInt(feeLimitSun) > 15_000_000n) mismatches.push('feeLimit 缺失或超过 15 TRX 上限');
  if (input !== expectedInput) mismatches.push('commit 参数与收据哈希不匹配');
  if (mismatches.length) return { ...base, status: 'mismatch', message: mismatches.join('；'), observed };

  const execution = isRecord(receipt.receipt) ? receipt.receipt : undefined;
  const executionResult = execution ? readString(execution, 'result') : undefined;
  if (contractRet !== 'SUCCESS' || executionResult !== 'SUCCESS') return { ...base, status: 'reverted', message: `链上执行未成功：${executionResult || contractRet || '结果缺失'}`, observed };
  if (!eventFound) return { ...base, status: 'mismatch', message: '未找到匹配的 ReceiptCommitted 事件', observed };
  if (!Number.isSafeInteger(receipt.blockNumber) || !Number.isSafeInteger(receipt.blockTimeStamp)) return { ...base, status: 'mismatch', message: '固化回执缺少可验证的区块高度或时间。', observed };
  return {
    ...base, status: 'confirmed', message: 'Nile 固化节点已核对 txID、签名钱包、Registry、commit 参数、事件和执行结果。',
    blockNumber: receipt.blockNumber as number, blockTimeStamp: receipt.blockTimeStamp as number,
    ...(Number.isSafeInteger(receipt.fee) ? { feeSun: receipt.fee as number } : {}),
    ...(execution && Number.isSafeInteger(execution.energy_usage_total) ? { energyUsageTotal: execution.energy_usage_total as number } : {}), observed,
  };
}

const sun = z.string().regex(/^(0|[1-9]\d{0,17})$/);
const costs = z.object({ rentalSun: sun, serviceSun: sun, activationSun: sun, chainReserveSun: sun, otherReserveSun: sun, totalSun: sun }).strict();
const payloadSchema = z.object({
  schema: z.literal('energydesk.procurement-receipt.v1'),
  product: z.literal('EnergyDesk'),
  receiptKind: z.literal('procurement-decision'),
  decisionStatus: z.literal('candidate_selected_not_ordered'),
  report: z.object({ mode: z.enum(['live', 'fixture']), snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/), quoteCreatedAt: z.iso.datetime(), quoteExpiresAt: z.iso.datetime() }).strict(),
  request: z.object({ energy: z.number().int().min(1).max(10_000_000), duration: z.enum(['1h', '1d', '3d', '30d']), recipient: z.string().refine(validTronAddress), budgetSun: sun, deadline: z.iso.datetime() }).strict(),
  plan: z.object({
    id: z.string().min(1).max(500), kind: z.enum(['single', 'split']), estimatedDeliverySeconds: z.number().int().min(0).max(86_400),
    costs: costs.extend({ budgetHeadroomSun: sun }).strict(),
    allocations: z.array(z.object({ providerId: z.enum(['tronenergyrent', 'justlend']), providerName: z.string().min(1).max(80), energy: z.number().int().min(1).max(10_000_000), quoteFetchedAt: z.iso.datetime(), quoteExpiresAt: z.iso.datetime(), deliverySeconds: z.number().int().min(0).max(86_400), costs }).strict()).min(1).max(2),
  }).strict(),
  anchor: z.object({ network: z.literal(NILE_NETWORK), chainId: z.literal(NILE_CHAIN_ID), walletAddress: z.string().refine(validTronAddress), registryAddress: z.string().refine(validTronAddress), method: z.literal(RECEIPT_METHOD), callValueSun: z.literal('0') }).strict(),
}).strict().superRefine((payload, context) => {
  const fields = ['rentalSun', 'serviceSun', 'activationSun', 'chainReserveSun', 'otherReserveSun'] as const;
  if (payload.plan.allocations.reduce((total, allocation) => total + allocation.energy, 0) !== payload.request.energy) context.addIssue({ code: 'custom', path: ['plan', 'allocations'], message: '分配总量与需求不一致' });
  for (const [index, allocation] of payload.plan.allocations.entries()) {
    const total = fields.reduce((sum, field) => sum + BigInt(allocation.costs[field]), 0n);
    if (total !== BigInt(allocation.costs.totalSun)) context.addIssue({ code: 'custom', path: ['plan', 'allocations', index, 'costs'], message: '分配成本加总不一致' });
  }
  for (const field of [...fields, 'totalSun'] as const) {
    const total = payload.plan.allocations.reduce((sum, allocation) => sum + BigInt(allocation.costs[field]), 0n);
    if (total !== BigInt(payload.plan.costs[field])) context.addIssue({ code: 'custom', path: ['plan', 'costs', field], message: '方案成本与分配成本不一致' });
  }
  if (BigInt(payload.plan.costs.totalSun) + BigInt(payload.plan.costs.budgetHeadroomSun) !== BigInt(payload.request.budgetSun)) context.addIssue({ code: 'custom', path: ['plan', 'costs', 'budgetHeadroomSun'], message: '预算余额不一致' });
});

export function isProcurementEvidencePayload(value: unknown): value is ProcurementEvidencePayload {
  return payloadSchema.safeParse(value).success;
}
