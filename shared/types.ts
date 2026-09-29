export type ProviderId = 'tronenergyrent' | 'justlend';
export type Duration = '1h' | '1d' | '3d' | '30d';
export type Mode = 'live' | 'fixture';
export interface ProcurementScenario {
  id: 'seoul-event-close';
  eventName: string;
  workerCount: number;
  payoutCount: number;
  plannedEnergyPerPayout: number;
  eventEndsAt: string;
}
export interface ProcurementRequest {
  energy: number;
  duration: Duration;
  recipient: string;
  recipientActivated: boolean;
  budgetSun: string;
  deadline: string;
  chainFeeReserveSun: string;
  otherReserveSun: string;
  justlendDeliverySeconds: number;
  mode: Mode;
  fixtureRevision: 1 | 2;
  scenario?: ProcurementScenario;
}
export interface ProviderQuote {
  id: ProviderId;
  name: string;
  status: 'ready' | 'error' | 'unsupported';
  mode: Mode;
  sourceUrl: string;
  docsUrl: string;
  fetchedAt: string;
  duration: Duration;
  supportedDurations: string[];
  minEnergy: number;
  maxEnergy: number;
  availableEnergy: number;
  unitPriceSun: string;
  activationSun: string;
  serviceSun: string;
  deliverySeconds: number;
  deliveryBasis: string;
  feeBasis: string;
  method: string;
  notes: string[];
  error?: string;
  evidence: Record<string, unknown>;
}
export interface CostBreakdown { rentalSun: string; serviceSun: string; activationSun: string; chainReserveSun: string; otherReserveSun: string; totalSun: string }
export interface Allocation extends CostBreakdown { providerId: ProviderId; providerName: string; energy: number; deliverySeconds: number }
export interface Plan extends CostBreakdown {
  id: string;
  kind: 'single' | 'split';
  allocations: Allocation[];
  feasible: boolean;
  reasons: string[];
  estimatedDeliverySeconds: number;
  budgetHeadroomSun: string;
}
export interface SearchReport {
  stepEnergy: number;
  examined: number;
  feasible: number;
  rejected: { budget: number; capacity: number; minimum: number; deadline: number; source: number };
  scope: string;
}
export interface ComparisonReport {
  id: string;
  createdAt: string;
  expiresAt: string;
  input: ProcurementRequest;
  quotes: ProviderQuote[];
  recommended: Plan | null;
  bestSingle: Plan | null;
  bestSplit: Plan | null;
  alternatives: Plan[];
  rejectedExamples: Plan[];
  search: SearchReport;
  noSolutionReasons: string[];
  assumptions: string[];
  snapshotDigest: string;
  recheck?: { previousReportId: string; status: 'unchanged' | 'changed' | 'invalid'; previousTotalSun: string | null; currentTotalSun: string | null; reasons: string[] };
}
