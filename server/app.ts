import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { optimize, evaluateAllocation } from '../shared/optimizer';
import type { ComparisonReport, ProcurementRequest, ProviderQuote } from '../shared/types';
import { fetchQuotes, type Fetcher } from './providers';
import { requestSchema } from './validation';
import { LookupError, lookupRequest } from './history';
import { buildProcurementEvidence, NILE_CHAIN_ID, NILE_NETWORK, RECEIPT_METHOD } from '../shared/evidence';
import { isProcurementEvidencePayload, prepareProcurementEvidence, verifyNileEvidence } from './evidence';
import { validTronAddress } from './validation';

export function buildReport(input: ProcurementRequest, quotes: ProviderQuote[], now: string): ComparisonReport {
  return { id: `${input.mode === 'fixture' ? 'demo' : 'quote'}_${randomUUID()}`, createdAt: now, expiresAt: new Date(Date.parse(now) + 60_000).toISOString(), input, quotes, ...optimize(input, quotes, now), assumptions: ['仅做采购比较：未创建订单、未锁价、未预留库存、未签名或付款。', 'SUN 全程使用整数；1 TRX = 1,000,000 SUN。服务费未拆出的来源保留在总租赁报价内，不重复加收。', '链上与其他成本是用户按每笔订单设置的预留，实际费用可能不同；未验证钱包带宽与平台充值余额。', '拆单按并行采购估算交付；实际下单操作耗时未包含。JustLend 交付时间为可编辑运营假设，非 SLA。', '线性报价仅在本次快照和供应商限制内适用；当前样本总额已核对。执行前应对具体分配量重新取得供应商订单报价。', '60 秒有效窗口是本工具的重新询价策略，不是供应商锁价承诺。'], snapshotDigest: createHash('sha256').update(JSON.stringify({ input, quotes })).digest('hex') };
}
export function createApp(options: { fetcher?: Fetcher; now?: () => string; registryAddress?: string | null } = {}) {
  const app = express(), reports = new Map<string, ComparisonReport>();
  const now = options.now || (() => new Date().toISOString());
  const configuredRegistry = options.registryAddress === undefined ? (process.env.NILE_RECEIPT_REGISTRY_ADDRESS || process.env.TRON_RECEIPT_REGISTRY_ADDRESS)?.trim() : options.registryAddress;
  const registryAddress = configuredRegistry && validTronAddress(configuredRegistry) ? configuredRegistry : null;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !['http://127.0.0.1:5175', 'http://localhost:5175', 'http://127.0.0.1:8789', 'http://localhost:8789'].includes(origin)) { res.status(403).json({ error: '来源不在本地允许列表' }); return; }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, product: 'EnergyDesk', providerCount: 2, readOnly: true }));
  app.get('/api/evidence/config', (_req, res) => res.json({ network: NILE_NETWORK, chainId: NILE_CHAIN_ID, method: RECEIPT_METHOD, registryAddress, ready: Boolean(registryAddress) }));
  app.post('/api/lookup', async (req, res) => {
    const parsed = z.object({ query: z.string().trim().min(1).max(128) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: '请输入一个完整的 TRON 地址或 64 位交易哈希。' }); return; }
    try { res.json(await lookupRequest(parsed.data.query, options.fetcher, now())); }
    catch (error) {
      if (error instanceof LookupError) { res.status(error.status).json({ code: error.code, error: error.message }); return; }
      throw error;
    }
  });
  async function compare(input: ProcurementRequest) {
    const quotes = await fetchQuotes(input, options.fetcher, now());
    const report = buildReport(input, quotes, now());
    reports.set(report.id, report);
    if (reports.size > 100) reports.delete(reports.keys().next().value!);
    return report;
  }
  app.post('/api/compare', async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；') }); return; }
    res.json(await compare(parsed.data));
  });
  app.post('/api/recheck', async (req, res) => {
    const parsed = z.object({ reportId: z.string().max(100), planId: z.string().max(200).optional(), fixtureRevision: z.union([z.literal(1), z.literal(2)]).optional() }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: '重新询价参数无效' }); return; }
    const prior = reports.get(parsed.data.reportId);
    if (!prior) { res.status(404).json({ error: '报价快照已失效或服务已重启，请重新比较' }); return; }
    const plan = [prior.recommended, prior.bestSingle, prior.bestSplit, ...prior.alternatives].find(p => p && p.id === (parsed.data.planId || prior.recommended?.id));
    const input = { ...prior.input, ...(prior.input.mode === 'fixture' && parsed.data.fixtureRevision ? { fixtureRevision: parsed.data.fixtureRevision } : {}) };
    const report = await compare(input);
    const updated = plan ? evaluateAllocation(plan.allocations.map(a => ({ quote: report.quotes.find(q => q.id === a.providerId)!, energy: a.energy })), input, report.createdAt) : null;
    const sourceChanged = plan?.allocations.some(a => {
      const before = prior.quotes.find(q => q.id === a.providerId)!, after = report.quotes.find(q => q.id === a.providerId)!;
      return before.unitPriceSun !== after.unitPriceSun || before.activationSun !== after.activationSun || before.serviceSun !== after.serviceSun || before.deliverySeconds !== after.deliverySeconds || before.minEnergy !== after.minEnergy || before.maxEnergy !== after.maxEnergy || before.availableEnergy !== after.availableEnergy;
    });
    const status = !updated?.feasible ? 'invalid' : sourceChanged || updated.totalSun !== plan?.totalSun ? 'changed' : 'unchanged';
    report.recheck = { previousReportId: prior.id, status, previousTotalSun: plan?.totalSun || null, currentTotalSun: updated?.feasible ? updated.totalSun : null, reasons: !updated ? ['原快照没有可行计划，已重新搜索。'] : !updated.feasible ? updated.reasons : status === 'changed' ? ['价格、库存或约束已变化；原计划需要重新确认。'] : ['原分配方案仍满足当前报价与约束；这是重新校验，不是库存锁定。'] };
    res.json(report);
  });
  app.post('/api/evidence/prepare', (req, res) => {
    const parsed = z.object({ reportId: z.string().max(100), planId: z.string().max(500), walletAddress: z.string().refine(validTronAddress, '钱包地址无效') }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: '凭证参数无效，请重新连接钱包并选择方案。' }); return; }
    if (!registryAddress) { res.status(503).json({ code: 'REGISTRY_NOT_CONFIGURED', error: 'ReceiptRegistry 尚未部署或配置。设置 NILE_RECEIPT_REGISTRY_ADDRESS 后重启 API。' }); return; }
    const report = reports.get(parsed.data.reportId);
    if (!report) { res.status(404).json({ error: '报价快照已失效或服务已重启，请重新生成计划。' }); return; }
    const plan = [report.recommended, report.bestSingle, report.bestSplit, ...report.alternatives].find(candidate => candidate?.id === parsed.data.planId);
    if (!plan) { res.status(400).json({ error: '所选方案不属于这份报价快照。' }); return; }
    res.json(prepareProcurementEvidence(buildProcurementEvidence(report, plan, parsed.data.walletAddress, registryAddress)));
  });
  app.post('/api/evidence/verify', async (req, res) => {
    const parsed = z.object({ txId: z.string().regex(/^[a-fA-F0-9]{64}$/), payload: z.unknown() }).strict().safeParse(req.body);
    if (!parsed.success || !isProcurementEvidencePayload(parsed.data.payload)) { res.status(400).json({ error: '交易哈希或采购收据格式无效。' }); return; }
    try { res.json(await verifyNileEvidence(parsed.data.txId.toLowerCase(), parsed.data.payload, options.fetcher, now())); }
    catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Nile 核验服务暂不可用。' }); }
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof SyntaxError ? 400 : 500).json({ error: error instanceof SyntaxError ? '请求 JSON 格式错误' : '比较服务暂不可用，请重试' }); });
  return app;
}
