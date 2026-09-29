import type { ComparisonReport } from './types';
import { formatTrx } from './money';

export function procurementBrief(report: ComparisonReport, selectedPlanId: string | null, options: { now?: string; inputChanged?: boolean } = {}): string {
  const now = options.now || new Date().toISOString();
  const plans = [report.recommended, report.bestSingle, report.bestSplit, ...report.alternatives];
  const plan = selectedPlanId ? plans.find(p => p?.id === selectedPlanId) : report.recommended;
  if (selectedPlanId && !plan) throw new Error('所选方案不属于这份报价快照。');
  const scenario = report.input.scenario;
  return [
    scenario ? 'EnergyDesk · 国际活动关账采购简报' : 'EnergyDesk · 采购简报',
    `数据：${report.input.mode === 'fixture' ? '演示参数，非实时市场' : '真实公开来源快照'}`,
    ...(scenario ? [`业务：${scenario.eventName}；${scenario.workerCount} 位工作人员；${scenario.payoutCount} 笔工资与报销付款`, `时间：活动结束 ${scenario.eventEndsAt}；付款截止 ${report.input.deadline}`, `规划口径：${scenario.payoutCount} 笔 × ${scenario.plannedEnergyPerPayout.toLocaleString('en-US')} E = ${(scenario.payoutCount * scenario.plannedEnergyPerPayout).toLocaleString('en-US')} E；这是可编辑规划值，不是链上仿真。`] : []),
    `需求：${report.input.energy.toLocaleString('en-US')} Energy / ${report.input.duration}`,
    `接收地址：${report.input.recipient}`,
    `预算：${formatTrx(report.input.budgetSun)} TRX；最迟到达：${report.input.deadline}`,
    `报价时间：${report.createdAt}；工具刷新截止：${report.expiresAt}`,
    `状态：${options.inputChanged ? '表单已修改，此简报仍对应上次已比较条件；必须重新询价。' : Date.parse(now) >= Date.parse(report.expiresAt) ? '快照已过期，必须重新询价。' : '快照在工具刷新窗口内；没有锁价或预留库存。'}`,
    plan ? `所选方案：${plan.kind === 'split' ? '拆单' : '单家'}，${formatTrx(plan.totalSun)} TRX（含费用预留）` : '所选方案：无可行方案',
    ...(plan ? plan.allocations.map(a => `- ${a.providerName}：${a.energy.toLocaleString('en-US')} E，${formatTrx(a.totalSun)} TRX；交付估计 ${a.deliverySeconds} 秒`) : report.noSolutionReasons.map(r => `- ${r}`)),
    ...(plan ? [`费用：租赁 ${formatTrx(plan.rentalSun)} / 单列服务 ${formatTrx(plan.serviceSun)} / 激活 ${formatTrx(plan.activationSun)} / 链上预留 ${formatTrx(plan.chainReserveSun)} / 其他预留 ${formatTrx(plan.otherReserveSun)} TRX`] : []),
    `范围：${report.search.scope}`,
    '来源：', ...report.quotes.map(q => `- ${q.name}：${q.status}；${q.fetchedAt}；${q.sourceUrl}`),
    '假设与边界：', ...report.assumptions.map(a => `- ${a}`),
    ...(report.recheck ? [`重新询价：${report.recheck.status}；${report.recheck.reasons.join('；')}`] : []),
    `快照：${report.id} / SHA-256 ${report.snapshotDigest}`,
    `简报生成：${now}。未创建订单、未签名、未付款。`,
  ].join('\n');
}
