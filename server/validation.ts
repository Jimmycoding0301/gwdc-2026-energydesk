import { createHash } from 'node:crypto';
import { z } from 'zod';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function validTronAddress(address: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  let n = 0n;
  for (const c of address) n = n * 58n + BigInt(alphabet.indexOf(c));
  const bytes = Buffer.from(n.toString(16).padStart(50, '0'), 'hex');
  if (bytes.length !== 25 || bytes[0] !== 0x41) return false;
  const expected = createHash('sha256').update(createHash('sha256').update(bytes.subarray(0, 21)).digest()).digest().subarray(0, 4);
  return bytes.subarray(21).equals(expected);
}
export function tronAddressToHex(address: string): string {
  if (!validTronAddress(address)) throw new Error('TRON 地址校验失败');
  let n = 0n;
  for (const c of address) n = n * 58n + BigInt(alphabet.indexOf(c));
  return Buffer.from(n.toString(16).padStart(50, '0'), 'hex').subarray(0, 21).toString('hex');
}
const sun = z.string().regex(/^(0|[1-9]\d{0,14})$/).refine(v => BigInt(v) <= 100_000_000_000n, '金额不能超过 100,000 TRX');
const scenario = z.object({ id: z.literal('seoul-event-close'), eventName: z.string().trim().min(1).max(80), workerCount: z.number().int().min(1).max(500), payoutCount: z.number().int().min(1).max(500), plannedEnergyPerPayout: z.number().int().min(1).max(300_000), eventEndsAt: z.iso.datetime() }).strict();
export const requestSchema = z.object({ energy: z.number().int().min(1).max(10_000_000), duration: z.enum(['1h', '1d', '3d', '30d']), recipient: z.string().refine(validTronAddress, '请输入通过 Base58Check 校验的 TRON 地址'), recipientActivated: z.boolean(), budgetSun: sun.refine(v => BigInt(v) > 0n, '预算必须大于 0'), deadline: z.iso.datetime(), chainFeeReserveSun: sun, otherReserveSun: sun, justlendDeliverySeconds: z.number().int().min(1).max(3600), mode: z.enum(['live', 'fixture']), fixtureRevision: z.union([z.literal(1), z.literal(2)]).default(1), scenario: scenario.optional() }).strict().superRefine((value, context) => {
  if (value.scenario && Date.parse(value.scenario.eventEndsAt) >= Date.parse(value.deadline)) context.addIssue({ code: 'custom', path: ['scenario', 'eventEndsAt'], message: '活动结束时间必须早于付款截止时间' });
});
