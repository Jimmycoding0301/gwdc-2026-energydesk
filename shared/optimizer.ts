import type { Allocation, CostBreakdown, Plan, ProcurementRequest, ProviderQuote, SearchReport } from './types';

const sum = (parts: CostBreakdown[], key: keyof CostBreakdown) => parts.reduce((n, p) => n + BigInt(p[key]), 0n).toString();
export function costAllocation(quote: ProviderQuote, energy: number, request: ProcurementRequest): Allocation {
  const rentalSun = (BigInt(quote.unitPriceSun) * BigInt(energy)).toString();
  const totalSun = [rentalSun, quote.serviceSun, quote.activationSun, request.chainFeeReserveSun, request.otherReserveSun].reduce((n, v) => n + BigInt(v), 0n).toString();
  return { providerId: quote.id, providerName: quote.name, energy, deliverySeconds: quote.deliverySeconds, rentalSun, serviceSun: quote.serviceSun, activationSun: quote.activationSun, chainReserveSun: request.chainFeeReserveSun, otherReserveSun: request.otherReserveSun, totalSun };
}
export function evaluateAllocation(allocations: { quote: ProviderQuote; energy: number }[], input: ProcurementRequest, now: string): Plan {
  const reasons: string[] = [];
  for (const { quote, energy } of allocations) {
    if (quote.status !== 'ready') reasons.push(`${quote.name}：${quote.error || '报价不可用'}`);
    if (quote.status === 'ready' && energy < quote.minEnergy) reasons.push(`${quote.name}：低于最小订单 ${quote.minEnergy.toLocaleString()} Energy`);
    if (quote.status === 'ready' && energy > Math.min(quote.maxEnergy, quote.availableEnergy)) reasons.push(`${quote.name}：库存或单笔上限不足`);
  }
  const legs = allocations.map(({ quote, energy }) => costAllocation(quote, energy, input));
  const cost = Object.fromEntries(['rentalSun', 'serviceSun', 'activationSun', 'chainReserveSun', 'otherReserveSun', 'totalSun'].map(key => [key, sum(legs, key as keyof CostBreakdown)])) as unknown as CostBreakdown;
  const estimatedDeliverySeconds = Math.max(...legs.map(p => p.deliverySeconds));
  if (BigInt(cost.totalSun) > BigInt(input.budgetSun)) reasons.push('含全部费用预留后超出预算');
  if (Date.parse(now) + estimatedDeliverySeconds * 1000 > Date.parse(input.deadline)) reasons.push('预计交付晚于最迟到达时间');
  return { ...cost, id: allocations.map(p => `${p.quote.id}:${p.energy}`).join('+'), kind: allocations.length === 1 ? 'single' : 'split', allocations: legs, feasible: reasons.length === 0, reasons, estimatedDeliverySeconds, budgetHeadroomSun: (BigInt(input.budgetSun) - BigInt(cost.totalSun)).toString() };
}

export function optimize(input: ProcurementRequest, quotes: ProviderQuote[], now: string) {
  const plans: Plan[] = [];
  const step = 1000;
  for (const quote of quotes) plans.push(evaluateAllocation([{ quote, energy: input.energy }], input, now));
  // Search each pair on a 1,000-energy grid and exact constraint endpoints.
  // The endpoints matter when inventory/minimum is not a multiple of the grid.
  for (let a = 0; a < quotes.length; a++) for (let b = a + 1; b < quotes.length; b++) {
    const left = quotes[a], right = quotes[b];
    const points = new Set<number>();
    for (let energy = step; energy < input.energy; energy += step) points.add(energy);
    for (const energy of [left.minEnergy, Math.min(left.maxEnergy, left.availableEnergy), input.energy - right.minEnergy, input.energy - Math.min(right.maxEnergy, right.availableEnergy)]) {
      if (Number.isSafeInteger(energy) && energy > 0 && energy < input.energy) points.add(energy);
    }
    for (const energy of points) plans.push(evaluateAllocation([{ quote: left, energy }, { quote: right, energy: input.energy - energy }], input, now));
  }
  const compare = (a: Plan, b: Plan) => BigInt(a.totalSun) === BigInt(b.totalSun) ? a.allocations.length - b.allocations.length || a.estimatedDeliverySeconds - b.estimatedDeliverySeconds || a.id.localeCompare(b.id) : BigInt(a.totalSun) < BigInt(b.totalSun) ? -1 : 1;
  const eligible = plans.filter(p => p.feasible).sort(compare);
  const bestSingle = eligible.find(p => p.kind === 'single') || null;
  const bestSplit = eligible.find(p => p.kind === 'split') || null;
  const rejected = plans.filter(p => !p.feasible);
  const search: SearchReport = {
    stepEnergy: step, examined: plans.length, feasible: eligible.length,
    rejected: { budget: rejected.filter(p => p.reasons.some(r => r.includes('预算'))).length, capacity: rejected.filter(p => p.reasons.some(r => r.includes('库存'))).length, minimum: rejected.filter(p => p.reasons.some(r => r.includes('最小订单'))).length, deadline: rejected.filter(p => p.reasons.some(r => r.includes('交付'))).length, source: rejected.filter(p => p.allocations.some(a => quotes.find(q => q.id === a.providerId)?.status !== 'ready')).length },
    scope: `单家全量 + 两家拆单；1,000 Energy 步长，加入最小单与库存边界；${plans.length} 个候选。按含费总额排序，同价优先少订单、再优先更快交付。仅在此搜索范围内推荐。`,
  };
  return { recommended: eligible[0] || null, bestSingle, bestSplit, alternatives: eligible.slice(1, 5), rejectedExamples: [...plans.filter(p => !p.feasible && p.kind === 'single'), ...rejected.filter(p => p.kind === 'split').sort(compare).slice(0, 2)], search, noSolutionReasons: eligible.length ? [] : [...new Set(rejected.flatMap(p => p.reasons))] };
}
