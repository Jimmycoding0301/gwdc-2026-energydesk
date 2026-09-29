import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { trxToSun, formatTrx } from '../shared/money';
import { optimize } from '../shared/optimizer';
import type { ProcurementRequest } from '../shared/types';
import { fetchQuotes, fetchJustlend, fetchTer, fixtureQuotes, JUSTLEND, TER, type Fetcher } from '../server/providers';
import { validTronAddress, requestSchema } from '../server/validation';
import { createApp } from '../server/app';

const NOW = '2026-09-28T10:00:00.000Z';
const input: ProcurementRequest = { energy: 130000, duration: '1h', recipient: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', recipientActivated: true, budgetSun: '8000000', deadline: '2026-09-28T10:10:00.000Z', chainFeeReserveSun: '300000', otherReserveSun: '0', justlendDeliverySeconds: 60, mode: 'fixture', fixtureRevision: 1 };
const closingInput: ProcurementRequest = { ...input, energy: 5_590_000, budgetSun: '260000000', deadline: '2026-09-28T10:45:00.000Z', scenario: { id: 'seoul-event-close', eventName: 'Seoul Creator Week · Closing Run', workerCount: 86, payoutCount: 86, plannedEnergyPerPayout: 65_000, eventEndsAt: '2026-09-28T10:15:00.000Z' } };
const envelope = (data: unknown) => new Response(JSON.stringify({ code: '0', data }), { status: 200 });
const sources = (options: { unit?: number; invalidTotal?: boolean; fail?: boolean; address?: string; activation?: number } = {}) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const unit = options.unit || 36;
  const fetcher: Fetcher = async (url, init) => {
    const path = String(url); calls.push({ url: path, init });
    if (options.fail) throw new Error('mock network down');
    if (path.startsWith(TER)) {
      const u = new URL(path), amount = Number(u.searchParams.get('energyAmount'));
      return new Response(JSON.stringify({ status: 'SUCCESS', payload: { availableEnergy: 400000000, minimumOrderEnergy: 15000, maximumOrderEnergy: 200000000, totalPriceSun: amount * 45 + (u.searchParams.has('preActivateDestinationAddress') ? 1500000 : 0), explanation: '45 SUN per Energy' } }));
    }
    if (path.endsWith('/v1/config')) return envelope({ min_energy: 65000, max_energy: 5000000, durations: ['1h'] });
    if (path.endsWith('/v1/price/current')) return envelope({ unit_price_sun: unit });
    if (path.endsWith('/v1/pool/health')) return envelope({ available_energy: 10000000, max_single_order_energy: 5000000, status: 'ok' });
    if (path.endsWith('/v1/price')) {
      const body = JSON.parse(init?.body as string), amount = body.energy_per_receiver, activation = options.activation || 0;
      return envelope({ unit_price_sun: unit, total_energy_price_sun: amount * unit, total_activation_fee_sun: activation, total_payable_sun: options.invalidTotal ? 1 : amount * unit + activation, pool_available_energy: 10000000, max_single_order_energy: 5000000, can_fulfill: true, items: [{ receive_address: options.address || body.receivers[0], energy_amount: amount, energy_price_sun: amount * unit, activation_fee_sun: activation, needs_activation: activation > 0 }] });
    }
    throw new Error(`Unexpected endpoint ${path}`);
  };
  return { fetcher, calls };
};

describe('integer accounting and constraints', () => {
  it('converts decimal TRX without floating point; refuses truncation', () => {
    expect(trxToSun('1.000001')).toBe('1000001'); expect(formatTrx('1000001')).toBe('1.000001'); expect(() => trxToSun('0.0000001')).toThrow(); expect(() => trxToSun('-1')).toThrow();
  });
  it('validates TRON checksum, not just address shape', () => {
    expect(validTronAddress(input.recipient)).toBe(true); expect(validTronAddress(`${input.recipient.slice(0, -1)}9`)).toBe(false); expect(validTronAddress('')).toBe(false);
  });
  it('rejects fractional energy, bad monetary schema and missing deadline', () => {
    expect(requestSchema.safeParse({ ...input, energy: 3.5 }).success).toBe(false); expect(requestSchema.safeParse({ ...input, budgetSun: 8000000 }).success).toBe(false); expect(requestSchema.safeParse({ ...input, deadline: null }).success).toBe(false);
    expect(requestSchema.safeParse(closingInput).success).toBe(true);
    expect(requestSchema.safeParse({ ...closingInput, scenario: { ...closingInput.scenario!, eventEndsAt: closingInput.deadline } }).success).toBe(false);
  });
  it('recommends capacity constrained split and counts per-order fees', () => {
    const result = optimize(input, fixtureQuotes(input, NOW), NOW);
    expect(result.recommended?.kind).toBe('split'); expect(result.recommended?.totalSun).toBe('5100000'); expect(result.recommended?.chainReserveSun).toBe('600000');
    expect(result.recommended?.allocations.map(a => a.energy)).toEqual([40000, 90000]); expect(result.bestSingle?.totalSun).toBe('6150000');
  });
  it('includes exact non-grid capacity endpoints', () => {
    const quotes = fixtureQuotes(input, NOW); quotes[1].availableEnergy = 89753;
    expect(optimize(input, quotes, NOW).recommended?.allocations.map(a => a.energy)).toEqual([40247, 89753]);
  });
  it('rejects budget that covers rental but not all transaction reserves', () => {
    const result = optimize({ ...input, budgetSun: '4900000' }, fixtureQuotes(input, NOW), NOW);
    expect(result.recommended).toBeNull(); expect(result.search.rejected.budget).toBeGreaterThan(0);
  });
  it('rejects missed deadline but accepts exact boundary', () => {
    const quotes = fixtureQuotes(input, NOW);
    expect(optimize({ ...input, deadline: '2026-09-28T10:00:09.000Z' }, quotes, NOW).recommended).toBeNull();
    expect(optimize({ ...input, deadline: '2026-09-28T10:00:10.000Z' }, quotes, NOW).recommended?.allocations[0].providerId).toBe('tronenergyrent');
  });
  it('does not suggest under-minimum orders or exceed aggregate inventory', () => {
    const quotes = fixtureQuotes(input, NOW); const result = optimize({ ...input, energy: 10000 }, quotes, NOW); expect(result.recommended).toBeNull();
    quotes.forEach(q => { q.availableEnergy = 50000; }); expect(optimize(input, quotes, NOW).recommended).toBeNull();
  });
  it('does not mutate request or quote evidence while searching', () => {
    const quotes = fixtureQuotes(input, NOW), before = JSON.stringify({ input, quotes }); optimize(input, quotes, NOW); expect(JSON.stringify({ input, quotes })).toBe(before);
  });
  it('compares all-in cost and prefers a single provider when split adds fees', () => {
    const quotes = fixtureQuotes(input, NOW); quotes[1].availableEnergy = 999999;
    const result = optimize(input, quotes, NOW); expect(result.recommended?.kind).toBe('single'); expect(BigInt(result.bestSplit!.totalSun)).toBeGreaterThan(BigInt(result.bestSingle!.totalSun));
  });
  it('covers all 86 payouts only by splitting the closing run across constrained inventories', () => {
    const result = optimize(closingInput, fixtureQuotes(closingInput, NOW), NOW);
    expect(result.bestSingle).toBeNull();
    expect(result.recommended?.allocations.map(part => part.energy)).toEqual([1_790_000, 3_800_000]);
    expect(result.recommended?.totalSun).toBe('195150000');
    const refreshed = optimize({ ...closingInput, fixtureRevision: 2 }, fixtureQuotes({ ...closingInput, fixtureRevision: 2 }, NOW), NOW);
    expect(refreshed.recommended?.allocations.map(part => part.energy)).toEqual([3_390_000, 2_200_000]);
    expect(refreshed.recommended?.totalSun).toBe('236750000');
  });
});

describe('public quote adapters', () => {
  it('uses two actual provider schemas and never calls ordering/signing endpoints', async () => {
    const mock = sources(), result = await fetchQuotes({ ...input, mode: 'live' }, mock.fetcher, NOW);
    expect(result.map(q => q.status)).toEqual(['ready', 'ready']); expect(result.map(q => q.unitPriceSun)).toEqual(['45', '36']);
    expect(mock.calls.filter(c => c.init?.method === 'POST').map(c => c.url)).toEqual([`${JUSTLEND}/v1/price`]);
    expect(mock.calls.every(c => !/buy|order|wallet|sign/.test(c.url))).toBe(true);
  });
  it('preserves distinct provider activation fees', async () => {
    const mock = sources({ activation: 1100000 });
    const ter = await fetchTer({ ...input, recipientActivated: false }, mock.fetcher, NOW), jl = await fetchJustlend(input, mock.fetcher, NOW);
    expect(ter.activationSun).toBe('1500000'); expect(jl.activationSun).toBe('1100000');
  });
  it('marks unsupported duration without treating 1h price as 1d price', async () => {
    const mock = sources(); const result = await fetchJustlend({ ...input, duration: '1d' }, mock.fetcher, NOW);
    expect(result.status).toBe('unsupported'); expect(mock.calls.some(c => c.init?.method === 'POST')).toBe(false);
  });
  it('fails closed on mismatched total and recipient', async () => {
    await expect(fetchJustlend(input, sources({ invalidTotal: true }).fetcher, NOW)).rejects.toThrow('不一致');
    await expect(fetchJustlend(input, sources({ address: 'not-the-recipient' }).fetcher, NOW)).rejects.toThrow('不一致');
  });
  it('keeps live errors visible and never falls back to fixture', async () => {
    const result = await fetchQuotes({ ...input, mode: 'live' }, sources({ fail: true }).fetcher, NOW);
    expect(result.every(q => q.status === 'error' && q.mode === 'live')).toBe(true); expect(optimize(input, result, NOW).recommended).toBeNull();
  });
  it('does not trust schema drift or fractional SUN', async () => {
    const bad: Fetcher = async () => new Response(JSON.stringify({ status: 'SUCCESS', payload: { totalPriceSun: 1.2 } }));
    const result = await fetchQuotes({ ...input, mode: 'live' }, bad, NOW); expect(result.every(q => q.status === 'error')).toBe(true);
  });
});

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });
async function start() {
  const server = createApp({ now: () => NOW, fetcher: sources().fetcher }).listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('no port');
  return async (path: string, body: unknown, origin?: string) => fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
}
describe('report API and stale-plan recovery', () => {
  it('turns the expired closing allocation red and returns a newly feasible split', async () => {
    const post = await start(), first = await (await post('/api/compare', closingInput)).json();
    expect(first.bestSingle).toBeNull();
    expect(first.recommended.allocations.map((part: { energy: number }) => part.energy)).toEqual([1_790_000, 3_800_000]);
    const next = await (await post('/api/recheck', { reportId: first.id, planId: first.recommended.id, fixtureRevision: 2 })).json();
    expect(next.recheck.status).toBe('invalid');
    expect(next.recheck.currentTotalSun).toBeNull();
    expect(next.recommended.allocations.map((part: { energy: number }) => part.energy)).toEqual([3_390_000, 2_200_000]);
  });
  it('returns auditable snapshot and invalidates old allocation after inventory disappears', async () => {
    const post = await start(), first = await (await post('/api/compare', input)).json();
    expect(first.recommended.totalSun).toBe('5100000'); expect(first.snapshotDigest).toMatch(/^[a-f0-9]{64}$/); expect(first.id).toMatch(/^demo_/);
    const next = await (await post('/api/recheck', { reportId: first.id, fixtureRevision: 2 })).json();
    expect(next.recheck.status).toBe('invalid'); expect(next.recheck.currentTotalSun).toBeNull(); expect(next.recommended.kind).toBe('single'); expect(next.recommended.totalSun).toBe('6150000');
  });
  it('rechecks unchanged quote without claiming stock locked', async () => {
    const post = await start(), first = await (await post('/api/compare', input)).json(), next = await (await post('/api/recheck', { reportId: first.id })).json();
    expect(next.recheck.status).toBe('unchanged'); expect(next.recheck.reasons[0]).toContain('不是库存锁定');
  });
  it('rejects arbitrary origin, malformed address, and unrecognized snapshot', async () => {
    const post = await start(); expect((await post('/api/compare', input, 'https://evil.example')).status).toBe(403); expect((await post('/api/compare', { ...input, recipient: 'Tinvalid' })).status).toBe(400); expect((await post('/api/recheck', { reportId: 'missing' })).status).toBe(404);
  });
});
