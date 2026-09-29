import type { ComparisonReport, Plan } from './types';

export const NILE_CHAIN_ID = '0xcd8690dc';
export const NILE_NETWORK = 'TRON Nile testnet';
export const RECEIPT_METHOD = 'commit(bytes32,bytes32)';
export const RECEIPT_KIND = 'energydesk.procurement-decision.v1';
/** keccak256('commit(bytes32,bytes32)') first 4 bytes; covered against TronWeb in tests. */
export const RECEIPT_SELECTOR = 'e3ce094d';

export interface ProcurementEvidencePayload {
  schema: 'energydesk.procurement-receipt.v1';
  product: 'EnergyDesk';
  receiptKind: 'procurement-decision';
  decisionStatus: 'candidate_selected_not_ordered';
  report: {
    mode: 'live' | 'fixture';
    snapshotDigest: string;
    quoteCreatedAt: string;
    quoteExpiresAt: string;
  };
  request: {
    energy: number;
    duration: string;
    recipient: string;
    budgetSun: string;
    deadline: string;
  };
  plan: {
    id: string;
    kind: 'single' | 'split';
    estimatedDeliverySeconds: number;
    costs: {
      rentalSun: string;
      serviceSun: string;
      activationSun: string;
      chainReserveSun: string;
      otherReserveSun: string;
      totalSun: string;
      budgetHeadroomSun: string;
    };
    allocations: Array<{
      providerId: string;
      providerName: string;
      energy: number;
      quoteFetchedAt: string;
      quoteExpiresAt: string;
      deliverySeconds: number;
      costs: {
        rentalSun: string;
        serviceSun: string;
        activationSun: string;
        chainReserveSun: string;
        otherReserveSun: string;
        totalSun: string;
      };
    }>;
  };
  anchor: {
    network: typeof NILE_NETWORK;
    chainId: typeof NILE_CHAIN_ID;
    walletAddress: string;
    registryAddress: string;
    method: typeof RECEIPT_METHOD;
    callValueSun: '0';
  };
}

export interface PreparedProcurementEvidence {
  payload: ProcurementEvidencePayload;
  canonical: string;
  receiptHash: string;
  kindHash: string;
  method: typeof RECEIPT_METHOD;
  callData: string;
}

export function buildProcurementEvidence(report: ComparisonReport, plan: Plan, walletAddress: string, registryAddress: string): ProcurementEvidencePayload {
  return {
    schema: 'energydesk.procurement-receipt.v1',
    product: 'EnergyDesk',
    receiptKind: 'procurement-decision',
    decisionStatus: 'candidate_selected_not_ordered',
    report: {
      mode: report.input.mode,
      snapshotDigest: report.snapshotDigest,
      quoteCreatedAt: report.createdAt,
      quoteExpiresAt: report.expiresAt,
    },
    request: {
      energy: report.input.energy,
      duration: report.input.duration,
      recipient: report.input.recipient,
      budgetSun: report.input.budgetSun,
      deadline: report.input.deadline,
    },
    plan: {
      id: plan.id,
      kind: plan.kind,
      estimatedDeliverySeconds: plan.estimatedDeliverySeconds,
      costs: {
        rentalSun: plan.rentalSun,
        serviceSun: plan.serviceSun,
        activationSun: plan.activationSun,
        chainReserveSun: plan.chainReserveSun,
        otherReserveSun: plan.otherReserveSun,
        totalSun: plan.totalSun,
        budgetHeadroomSun: plan.budgetHeadroomSun,
      },
      allocations: plan.allocations.map(allocation => {
        const quote = report.quotes.find(candidate => candidate.id === allocation.providerId);
        if (!quote) throw new Error(`缺少 ${allocation.providerId} 的报价快照。`);
        return {
          providerId: allocation.providerId,
          providerName: allocation.providerName,
          energy: allocation.energy,
          quoteFetchedAt: quote.fetchedAt,
          quoteExpiresAt: report.expiresAt,
          deliverySeconds: allocation.deliverySeconds,
          costs: {
            rentalSun: allocation.rentalSun,
            serviceSun: allocation.serviceSun,
            activationSun: allocation.activationSun,
            chainReserveSun: allocation.chainReserveSun,
            otherReserveSun: allocation.otherReserveSun,
            totalSun: allocation.totalSun,
          },
        };
      }),
    },
    anchor: {
      network: NILE_NETWORK,
      chainId: NILE_CHAIN_ID,
      walletAddress,
      registryAddress,
      method: RECEIPT_METHOD,
      callValueSun: '0',
    },
  };
}

/** RFC-8785-style key ordering for the JSON shapes used by this receipt. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function receiptCallDataFromHashes(kindHash: string, receiptHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(kindHash) || !/^[a-f0-9]{64}$/.test(receiptHash)) throw new Error('收据哈希格式无效');
  return `${RECEIPT_SELECTOR}${kindHash}${receiptHash}`;
}

async function browserSha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function validatePreparedProcurementEvidence(prepared: PreparedProcurementEvidence): Promise<boolean> {
  const canonical = canonicalJson(prepared.payload);
  const [receiptHash, kindHash] = await Promise.all([browserSha256(canonical), browserSha256(RECEIPT_KIND)]);
  return prepared.canonical === canonical && prepared.receiptHash === receiptHash && prepared.kindHash === kindHash && prepared.method === RECEIPT_METHOD && prepared.callData === receiptCallDataFromHashes(kindHash, receiptHash);
}

export function durablyStoreJson(storage: Pick<Storage, 'setItem' | 'getItem'>, key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error('持久化校验失败');
}
