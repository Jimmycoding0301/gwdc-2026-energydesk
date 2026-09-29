import { z } from 'zod';
import type { ProcurementRequest, ProviderId, ProviderQuote } from '../shared/types';

export const JUSTLEND = 'https://tegrow.ablesdxd.link';
export const TER = 'https://api.tronenergyrent.com/calculate-energy-price';
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const terSchema = z.object({ status: z.literal('SUCCESS'), payload: z.object({ availableEnergy: integer, minimumOrderEnergy: integer.positive(), maximumOrderEnergy: integer.positive(), totalPriceSun: integer.positive(), explanation: z.string() }) });
const jlConfig = z.object({ min_energy: integer.positive(), max_energy: integer.positive(), durations: z.array(z.string()) });
const jlPrice = z.object({ unit_price_sun: integer.positive() });
const jlPool = z.object({ available_energy: integer, max_single_order_energy: integer, status: z.string() });
const jlQuote = z.object({ unit_price_sun: integer.positive(), total_energy_price_sun: integer, total_activation_fee_sun: integer, total_payable_sun: integer.positive(), pool_available_energy: integer, max_single_order_energy: integer, can_fulfill: z.boolean(), items: z.array(z.object({ receive_address: z.string(), energy_amount: integer.positive(), energy_price_sun: integer, activation_fee_sun: integer, needs_activation: z.boolean() })).length(1) });
export type Fetcher = typeof fetch;

function base(id: ProviderId, input: ProcurementRequest, now: string): ProviderQuote {
  const ter = id === 'tronenergyrent';
  return { id, name: ter ? 'TronEnergyRent' : 'JustLend · Energy', status: 'ready', mode: input.mode, sourceUrl: ter ? TER : `${JUSTLEND}/v1/price`, docsUrl: ter ? 'https://tronenergyrent.com/en/overview-api' : 'https://docs.justlend.org/ai_support/mcp_server/', fetchedAt: now, duration: input.duration, supportedDurations: [], minEnergy: 0, maxEnergy: 0, availableEnergy: 0, unitPriceSun: '0', activationSun: '0', serviceSun: '0', deliverySeconds: ter ? 10 : input.justlendDeliverySeconds, deliveryBasis: ter ? '官网给出的下单后 1–10 秒；按 10 秒估计，不是交付保证。' : `运营假设 ${input.justlendDeliverySeconds} 秒；接口未提供交付 SLA，需采购前确认。`, feeBasis: '服务费未单列，已归入供应商总报价；链上费与其他费用按每单预留另计。', method: '', notes: [], evidence: {} };
}
async function readJson(url: string, fetcher: Fetcher, body?: unknown): Promise<unknown> {
  const response = await fetcher(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`报价源 HTTP ${response.status}`);
  return response.json();
}
function unwrap(value: unknown): unknown {
  return z.object({ code: z.literal('0'), data: z.unknown() }).parse(value).data;
}
export async function fetchTer(input: ProcurementRequest, fetcher: Fetcher = fetch, now = new Date().toISOString()): Promise<ProviderQuote> {
  const quote = base('tronenergyrent', input, now);
  quote.supportedDurations = ['1h', '1d', '3d', '30d'];
  // A sample at least the provider minimum exposes inventory even when the user's whole request is too small.
  // A bounded linear sample keeps a multi-million Energy closing run quoteable even
  // when one provider cannot accept the whole requirement as a single order.
  const sampleEnergy = Math.max(15_000, Math.min(input.energy, 130_000));
  const query = `?period=${input.duration}&energyAmount=${sampleEnergy}`;
  const raw = await readJson(`${TER}${query}`, fetcher);
  const p = terSchema.parse(raw).payload;
  if (p.totalPriceSun % sampleEnergy !== 0) throw new Error('供应商价格不能归一为整数 SUN/Energy，暂停推算');
  let activation = 0;
  let activatedEvidence: unknown;
  if (!input.recipientActivated) {
    activatedEvidence = await readJson(`${TER}${query}&preActivateDestinationAddress=1`, fetcher);
    activation = terSchema.parse(activatedEvidence).payload.totalPriceSun - p.totalPriceSun;
    if (!Number.isSafeInteger(activation) || activation < 0) throw new Error('激活费报价不一致');
  }
  return { ...quote, minEnergy: p.minimumOrderEnergy, maxEnergy: p.maximumOrderEnergy, availableEnergy: p.availableEnergy, unitPriceSun: String(p.totalPriceSun / sampleEnergy), activationSun: String(activation), method: `公开 calculate-energy-price 对 ${sampleEnergy.toLocaleString()} Energy 的即时总报价；按接口说明中的线性单价计算拆单。`, notes: ['使用平台预充值余额采购；充值链上费由每单费用预留覆盖。', input.recipientActivated ? '地址激活状态由用户声明；该源的计算接口不核验收款地址。' : '已向计算接口请求地址预激活费用。'], evidence: { requestUrl: `${TER}${query}`, sampleEnergy, response: raw, ...(activatedEvidence ? { activationResponse: activatedEvidence } : {}) } };
}
export async function fetchJustlend(input: ProcurementRequest, fetcher: Fetcher = fetch, now = new Date().toISOString()): Promise<ProviderQuote> {
  const quote = base('justlend', input, now);
  const responses = await Promise.all([readJson(`${JUSTLEND}/v1/config`, fetcher), readJson(`${JUSTLEND}/v1/price/current`, fetcher), readJson(`${JUSTLEND}/v1/pool/health`, fetcher)]);
  const config = jlConfig.parse(unwrap(responses[0])), price = jlPrice.parse(unwrap(responses[1])), pool = jlPool.parse(unwrap(responses[2]));
  const configured = { ...quote, supportedDurations: config.durations, minEnergy: config.min_energy, maxEnergy: Math.min(config.max_energy, pool.max_single_order_energy), availableEnergy: pool.available_energy, unitPriceSun: String(price.unit_price_sun), evidence: { config: responses[0], price: responses[1], pool: responses[2] } };
  if (!config.durations.includes(input.duration)) return { ...configured, status: 'unsupported', error: `当前仅支持 ${config.durations.join(' / ')}；不将 1h 价格套用到 ${input.duration}` };
  if (pool.status !== 'ok') throw new Error('供应商资源池状态不可用');
  const sampleEnergy = Math.max(config.min_energy, Math.min(input.energy, configured.maxEnergy));
  const requestBody = { receivers: [input.recipient], energy_per_receiver: sampleEnergy };
  const raw = await readJson(`${JUSTLEND}/v1/price`, fetcher, requestBody);
  const q = jlQuote.parse(unwrap(raw)), item = q.items[0];
  if (item.receive_address !== input.recipient || item.energy_amount !== sampleEnergy || q.total_energy_price_sun !== q.unit_price_sun * sampleEnergy || item.energy_price_sun !== q.total_energy_price_sun || item.activation_fee_sun !== q.total_activation_fee_sun || q.total_payable_sun !== q.total_energy_price_sun + q.total_activation_fee_sun) throw new Error('报价金额或目标地址不一致，拒绝使用');
  if (!q.can_fulfill) throw new Error('供应商报价表示当前资源池无法满足样本订单');
  return { ...configured, unitPriceSun: String(q.unit_price_sun), activationSun: String(q.total_activation_fee_sun), availableEnergy: Math.min(pool.available_energy, q.pool_available_energy), maxEnergy: Math.min(configured.maxEnergy, q.max_single_order_energy), method: `JustLend 官方 MCP 指定服务的纯报价接口，${sampleEnergy.toLocaleString()} Energy 实时报价；单价 × 分配量 + 接口激活费。`, notes: ['这是官方 MCP 集成的 Energy 直接采购服务；不是 sTRX 租赁合约的押金报价。', '接口对当前收款地址返回激活费；拆单保守地为每个来源保留各自激活费。'], evidence: { ...configured.evidence, requestBody, response: raw } };
}

export function fixtureQuotes(input: ProcurementRequest, now: string): ProviderQuote[] {
  const closingRun = input.scenario?.id === 'seoul-event-close';
  return (['tronenergyrent', 'justlend'] as const).map(id => {
    const quote = base(id, input, now), ter = id === 'tronenergyrent';
    const availableEnergy = closingRun
      ? ter ? 4_200_000 : input.fixtureRevision === 1 ? 3_800_000 : 2_200_000
      : ter ? 500_000 : input.fixtureRevision === 1 ? 90_000 : 0;
    const unitPriceSun = ter ? '45' : input.fixtureRevision === 1 ? '30' : closingRun ? '38' : '55';
    return { ...quote, status: input.duration === '1h' || ter ? 'ready' : 'unsupported', error: input.duration !== '1h' && !ter ? '演示：该源仅支持 1h' : undefined, supportedDurations: ter ? ['1h', '1d', '3d', '30d'] : ['1h'], minEnergy: ter ? 15000 : 65000, maxEnergy: 5_000_000, availableEnergy, unitPriceSun, activationSun: input.recipientActivated ? '0' : ter ? '1500000' : '1100000', method: closingRun ? '国际活动关账路演的本地报价快照；用于演示单家库存不足、拆单与到期后重新规划，不是当前供应商报价。' : '明确标注的本地演示参数；不是当前供应商报价。', notes: [closingRun ? '活动关账演示数据：价格、库存和变化均为本地参数，不代表真实市场。' : '演示数据，不代表真实库存、价格或交付。'], evidence: { fixture: true, scenario: closingRun ? 'seoul-event-close' : 'generic', revision: input.fixtureRevision } };
  });
}
export async function fetchQuotes(input: ProcurementRequest, fetcher: Fetcher = fetch, now = new Date().toISOString()): Promise<ProviderQuote[]> {
  if (input.mode === 'fixture') return fixtureQuotes(input, now);
  const results = await Promise.allSettled([fetchTer(input, fetcher, now), fetchJustlend(input, fetcher, now)]);
  return results.map((r, i) => r.status === 'fulfilled' ? r.value : { ...base(i === 0 ? 'tronenergyrent' : 'justlend', input, now), status: 'error', error: r.reason instanceof z.ZodError ? '报价源返回格式变化，已停止使用该来源' : r.reason instanceof Error && /HTTP|供应商|报价|激活费/.test(r.reason.message) ? r.reason.message : '报价源连接失败或超时；没有自动改用演示数据', method: '请求失败，无可用报价' });
}
