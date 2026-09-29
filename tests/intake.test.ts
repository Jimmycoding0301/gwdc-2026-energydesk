import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { classifyLookup, STARTING_POINTS } from '../shared/intake';
import { lookupRequest, RECEIPT_ENDPOINT } from '../server/history';
import { buildReport, createApp } from '../server/app';
import { fixtureQuotes } from '../server/providers';
import { procurementBrief } from '../shared/brief';
import type { ProcurementRequest } from '../shared/types';

const NOW = '2026-09-28T10:00:00.000Z';
const ADDRESS = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const HASH = 'ab'.repeat(32);
const receipt = (overrides: Record<string, unknown> = {}) => ({ id: HASH, blockNumber: 81234567, blockTimeStamp: 1780000000000, receipt: { result: 'SUCCESS', energy_usage_total: 65001 }, ...overrides });
const response = (data: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(data), { status }));

describe('read-only request intake', () => {
  it('checks addresses without network access and rejects invalid checksums', async () => {
    const fetcher = response({});
    expect(await lookupRequest(` ${ADDRESS} `, fetcher, NOW)).toEqual({ kind: 'address', address: ADDRESS });
    await expect(lookupRequest(`${ADDRESS.slice(0, -1)}9`, fetcher)).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(classifyLookup(`0x${HASH}`)).toBe('unknown');
    expect(classifyLookup(HASH.toUpperCase())).toBe('transaction');
  });
  it('reads only the fixed confirmed-node endpoint and rounds the editable buffer up', async () => {
    const fetcher = response(receipt());
    const result = await lookupRequest(HASH.toUpperCase(), fetcher, NOW);
    expect(fetcher).toHaveBeenCalledWith(RECEIPT_ENDPOINT, expect.objectContaining({ method: 'POST', body: JSON.stringify({ value: HASH }), redirect: 'error' }));
    expect(result).toMatchObject({ kind: 'transaction', energyUsage: 65001, suggestedEnergy: 74752, bufferPercent: 15, fetchedAt: NOW, network: 'mainnet' });
    expect(result).not.toHaveProperty('recipient');
  });
  it.each([0, 5000000])('does not clamp or auto-apply an unsupported suggestion from %s Energy', async energy => {
    const result = await lookupRequest(HASH, response(receipt({ receipt: { result: 'SUCCESS', energy_usage_total: energy } })), NOW);
    expect(result).toMatchObject({ energyUsage: energy, suggestedEnergy: null });
  });
  it.each([
    [{}, 'RECEIPT_NOT_FOUND'],
    [receipt({ id: 'cd'.repeat(32) }), 'INVALID_RECEIPT'],
    [receipt({ receipt: { result: 'OUT_OF_ENERGY', energy_usage_total: 65000 } }), 'TRANSACTION_FAILED'],
    [receipt({ receipt: { result: 'SUCCESS' } }), 'NO_ENERGY_FIELD'],
    [receipt({ receipt: { energy_usage_total: 65000 } }), 'RESULT_UNVERIFIED'],
    [receipt({ receipt: { result: 'SUCCESS', energy_usage_total: 1.5 } }), 'INVALID_RECEIPT'],
  ])('rejects unusable receipts without a fixture fallback', async (body, code) => {
    const fetcher = response(body);
    await expect(lookupRequest(HASH, fetcher, NOW)).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps rate limiting, malformed JSON and network failures explicit', async () => {
    await expect(lookupRequest(HASH, response({}, 429))).rejects.toMatchObject({ code: 'RPC_HTTP_ERROR' });
    await expect(lookupRequest(HASH, async () => new Response('not JSON'))).rejects.toMatchObject({ code: 'INVALID_RECEIPT' });
    await expect(lookupRequest(HASH, async () => { throw new Error('network'); })).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE' });
  });
  it('labels presets as editable starting points and does not invent an Energy requirement for TRX', () => {
    expect(STARTING_POINTS.find(p => p.id === 'trx')?.energy).toBe(0);
    expect(STARTING_POINTS.filter(p => p.energy > 0).every(p => p.note.includes('起点'))).toBe(true);
  });
});

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });
it('exposes lookup validation and provider errors over the actual Express route', async () => {
  const server = createApp({ now: () => NOW, fetcher: response({}) }).listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const post = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect(await (await post({ query: ADDRESS })).json()).toEqual({ kind: 'address', address: ADDRESS });
  expect((await post({ query: HASH, endpoint: 'https://example.com' })).status).toBe(400);
  const missing = await post({ query: HASH }); expect(missing.status).toBe(404); expect((await missing.json()).code).toBe('RECEIPT_NOT_FOUND');
});

const input: ProcurementRequest = { energy: 130000, duration: '1h', recipient: ADDRESS, recipientActivated: true, budgetSun: '8000000', deadline: '2026-09-28T10:10:00.000Z', chainFeeReserveSun: '300000', otherReserveSun: '0', justlendDeliverySeconds: 60, mode: 'fixture', fixtureRevision: 1 };
describe('portable procurement brief', () => {
  it('puts the event, people, payout count and editable estimate into the closing brief', () => {
    const closing: ProcurementRequest = { ...input, energy: 5_590_000, budgetSun: '260000000', deadline: '2026-09-28T10:45:00.000Z', scenario: { id: 'seoul-event-close', eventName: 'Seoul Creator Week · Closing Run', workerCount: 86, payoutCount: 86, plannedEnergyPerPayout: 65_000, eventEndsAt: '2026-09-28T10:15:00.000Z' } };
    const report = buildReport(closing, fixtureQuotes(closing, NOW), NOW);
    const text = procurementBrief(report, report.recommended!.id, { now: NOW });
    expect(text).toContain('国际活动关账采购简报');
    expect(text).toContain('86 位工作人员；86 笔');
    expect(text).toContain('86 笔 × 65,000 E = 5,590,000 E');
  });
  it('binds to the selected plan and includes costs, constraints and source evidence', () => {
    const report = buildReport(input, fixtureQuotes(input, NOW), NOW);
    const text = procurementBrief(report, report.bestSingle!.id, { now: NOW });
    expect(text).toContain('演示参数，非实时市场'); expect(text).toContain('单家，6.15 TRX'); expect(text).toContain(ADDRESS);
    expect(text).toContain('链上预留 0.3'); expect(text).toContain(report.snapshotDigest);
    for (const quote of report.quotes) { expect(text).toContain(quote.sourceUrl); expect(text).toContain(quote.fetchedAt); }
    expect(text).toContain(input.deadline); expect(text).toContain('未创建订单');
  });
  it('makes changed input and expired snapshots explicit without mixing new form values into the old report', () => {
    const report = buildReport(input, fixtureQuotes(input, NOW), NOW);
    expect(procurementBrief(report, null, { now: NOW, inputChanged: true })).toContain('此简报仍对应上次已比较条件');
    expect(procurementBrief(report, null, { now: report.expiresAt })).toContain('快照已过期');
    expect(() => procurementBrief(report, 'foreign-plan')).toThrow('不属于');
  });
});
