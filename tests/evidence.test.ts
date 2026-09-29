import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { TronWeb, utils as tronUtils } from 'tronweb';
import { buildProcurementEvidence, canonicalJson, durablyStoreJson, NILE_CHAIN_ID, NILE_NETWORK, RECEIPT_METHOD, validatePreparedProcurementEvidence } from '../shared/evidence';
import type { ProcurementRequest } from '../shared/types';
import { buildReport, createApp } from '../server/app';
import { fixtureQuotes } from '../server/providers';
import { prepareProcurementEvidence, receiptCallData, receiptEventTopic, receiptKindHash, verifyNileEvidence } from '../server/evidence';
import { tronAddressToHex } from '../server/validation';

const NOW = '2026-09-28T10:00:00.000Z';
const ADDRESS = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const TX_ID = 'ab'.repeat(32);
const input: ProcurementRequest = { energy: 130000, duration: '1h', recipient: ADDRESS, recipientActivated: true, budgetSun: '8000000', deadline: '2026-09-28T10:10:00.000Z', chainFeeReserveSun: '300000', otherReserveSun: '0', justlendDeliverySeconds: 60, mode: 'fixture', fixtureRevision: 1 };

function preparedReceipt() {
  const report = buildReport(input, fixtureQuotes(input, NOW), NOW);
  const plan = report.recommended!;
  return { report, plan, prepared: prepareProcurementEvidence(buildProcurementEvidence(report, plan, ADDRESS, ADDRESS)) };
}

function nodeFixture(overrides: { input?: string; contractRet?: string; result?: string; includeEvent?: boolean } = {}) {
  const { prepared } = preparedReceipt();
  const addressHex = tronAddressToHex(ADDRESS).toLowerCase();
  const callData = overrides.input || receiptCallData(prepared.receiptHash);
  const transaction = {
    txID: TX_ID,
    ret: [{ contractRet: overrides.contractRet || 'SUCCESS' }],
    raw_data: { fee_limit: 15_000_000, contract: [{ type: 'TriggerSmartContract', parameter: { value: { owner_address: addressHex, contract_address: addressHex, data: callData } } }] },
  };
  const timestampWord = Math.floor(Date.parse(NOW) / 1000).toString(16).padStart(64, '0');
  const receipt = {
    id: TX_ID,
    blockNumber: 123456,
    blockTimeStamp: Date.parse(NOW),
    fee: 1200,
    receipt: { result: overrides.result || 'SUCCESS', energy_usage_total: 987 },
    log: overrides.includeEvent === false ? [] : [{ address: addressHex.slice(2), topics: [receiptEventTopic(), addressHex.slice(2).padStart(64, '0'), receiptKindHash()], data: `${prepared.receiptHash}${timestampWord}` }],
  };
  const fetcher = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(String(request).includes('gettransactioninfo') ? receipt : transaction)));
  return { prepared, transaction, receipt, fetcher };
}

describe('deterministic procurement evidence', () => {
  it('binds provider allocations, every cost, quote times, status, wallet and registry', () => {
    const { report, plan, prepared } = preparedReceipt();
    expect(prepared.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.kindHash).toBe(receiptKindHash());
    expect(prepared.payload.decisionStatus).toBe('candidate_selected_not_ordered');
    expect(prepared.payload.report).toMatchObject({ quoteCreatedAt: report.createdAt, quoteExpiresAt: report.expiresAt, mode: 'fixture' });
    expect(prepared.payload.plan.costs).toEqual({ rentalSun: plan.rentalSun, serviceSun: plan.serviceSun, activationSun: plan.activationSun, chainReserveSun: plan.chainReserveSun, otherReserveSun: plan.otherReserveSun, totalSun: plan.totalSun, budgetHeadroomSun: plan.budgetHeadroomSun });
    expect(prepared.payload.plan.allocations.map(value => value.providerId)).toEqual(plan.allocations.map(value => value.providerId));
    expect(prepared.payload.plan.allocations.every(value => value.quoteFetchedAt === NOW && value.quoteExpiresAt === report.expiresAt)).toBe(true);
    expect(prepared.payload.anchor).toEqual({ network: NILE_NETWORK, chainId: NILE_CHAIN_ID, walletAddress: ADDRESS, registryAddress: ADDRESS, method: RECEIPT_METHOD, callValueSun: '0' });
  });
  it('canonicalizes object keys and produces the same digest for the same receipt', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    const first = preparedReceipt().prepared, second = preparedReceipt().prepared;
    expect(first.canonical).toBe(second.canonical);
    expect(first.receiptHash).toBe(second.receiptHash);
  });
  it('uses 0x-prefixed bytes32 values accepted by the real TronWeb 6.5 ABI encoder', () => {
    const { prepared } = preparedReceipt();
    const values = [`0x${prepared.kindHash}`, `0x${prepared.receiptHash}`];
    const encoded = tronUtils.abi.encodeParams(['bytes32', 'bytes32'], values).slice(2);
    const selector = TronWeb.sha3(RECEIPT_METHOD).slice(2, 10);
    expect(`${selector}${encoded}`).toBe(prepared.callData);
    expect(() => tronUtils.abi.encodeParams(['bytes32', 'bytes32'], [prepared.kindHash, prepared.receiptHash])).toThrow(/invalid BytesLike/);
  });
  it('recomputes canonical JSON, both hashes and exact calldata before trusting restored evidence', async () => {
    const { prepared } = preparedReceipt();
    await expect(validatePreparedProcurementEvidence(prepared)).resolves.toBe(true);
    await expect(validatePreparedProcurementEvidence({ ...prepared, canonical: `${prepared.canonical} ` })).resolves.toBe(false);
    await expect(validatePreparedProcurementEvidence({ ...prepared, receiptHash: '00'.repeat(32) })).resolves.toBe(false);
    const changedCallData = `${prepared.callData.slice(0, -1)}${prepared.callData.endsWith('0') ? '1' : '0'}`;
    await expect(validatePreparedProcurementEvidence({ ...prepared, callData: changedCallData })).resolves.toBe(false);
  });
  it('durably round-trips the exact signed transaction before broadcast and fails closed on storage errors', () => {
    const values = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) || null };
    const record = { txId: TX_ID, broadcastState: 'unknown', signedTransaction: { txID: TX_ID, raw_data_hex: 'aabb', signature: ['ccdd'] } };
    durablyStoreJson(storage, 'receipt', record);
    expect(JSON.parse(values.get('receipt')!)).toEqual(record);
    expect(() => durablyStoreJson({ setItem: () => undefined, getItem: () => null }, 'receipt', record)).toThrow('持久化校验失败');
  });
});

describe('fixed Nile solidified verification', () => {
  it('confirms only when transaction input, receipt event and execution all match', async () => {
    const fixture = nodeFixture();
    const result = await verifyNileEvidence(TX_ID, fixture.prepared.payload, fixture.fetcher, NOW);
    expect(result).toMatchObject({ status: 'confirmed', txId: TX_ID, blockNumber: 123456, feeSun: 1200, energyUsageTotal: 987, receiptHash: fixture.prepared.receiptHash });
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
    for (const call of fixture.fetcher.mock.calls) expect(JSON.parse(call[1]!.body as string)).toEqual({ value: TX_ID, visible: false });
  });
  it('keeps an absent solidified body as pending instead of inventing success or a replacement hash', async () => {
    const { prepared } = preparedReceipt();
    const result = await verifyNileEvidence(TX_ID, prepared.payload, async () => new Response('{}'), NOW);
    expect(result.status).toBe('pending'); expect(result.txId).toBe(TX_ID); expect(result.receiptHash).toBe(prepared.receiptHash);
  });
  it('classifies changed calldata or missing events as a mismatch', async () => {
    const changed = nodeFixture({ input: `deadbeef${'00'.repeat(64)}` });
    await expect(verifyNileEvidence(TX_ID, changed.prepared.payload, changed.fetcher, NOW)).resolves.toMatchObject({ status: 'mismatch' });
    const missing = nodeFixture({ includeEvent: false });
    await expect(verifyNileEvidence(TX_ID, missing.prepared.payload, missing.fetcher, NOW)).resolves.toMatchObject({ status: 'mismatch', message: expect.stringContaining('ReceiptCommitted') });
  });
  it('classifies a matching but failed contract call as reverted', async () => {
    const fixture = nodeFixture({ contractRet: 'REVERT', result: 'REVERT', includeEvent: false });
    await expect(verifyNileEvidence(TX_ID, fixture.prepared.payload, fixture.fetcher, NOW)).resolves.toMatchObject({ status: 'reverted' });
  });
});

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });
async function start(registryAddress: string | null) {
  const server = createApp({ now: () => NOW, registryAddress }).listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${address.port}`;
  return { get: (path: string) => fetch(`${base}${path}`), post: (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}

describe('evidence API configuration', () => {
  it('stays honestly deployment-blocked when no registry address is configured', async () => {
    const api = await start(null);
    await expect((await api.get('/api/evidence/config')).json()).resolves.toMatchObject({ ready: false, registryAddress: null, chainId: NILE_CHAIN_ID });
    const report = await (await api.post('/api/compare', input)).json();
    const response = await api.post('/api/evidence/prepare', { reportId: report.id, planId: report.recommended.id, walletAddress: ADDRESS });
    expect(response.status).toBe(503); await expect(response.json()).resolves.toMatchObject({ code: 'REGISTRY_NOT_CONFIGURED' });
  });
  it('prepares a receipt only from a stored report and its selected plan', async () => {
    const api = await start(ADDRESS);
    await expect((await api.get('/api/evidence/config')).json()).resolves.toMatchObject({ ready: true, registryAddress: ADDRESS });
    const report = await (await api.post('/api/compare', input)).json();
    const response = await api.post('/api/evidence/prepare', { reportId: report.id, planId: report.recommended.id, walletAddress: ADDRESS });
    expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/), payload: { plan: { id: report.recommended.id }, anchor: { registryAddress: ADDRESS } } });
  });
});
