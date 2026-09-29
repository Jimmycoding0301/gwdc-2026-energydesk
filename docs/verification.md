# EnergyDesk verification record

Updated: **2026-09-29 KST**.

## Automated verification

- `npm test`: 48 tests passed in the source workspace before packaging.
- `npm run build`: TypeScript and Vite production build passed.
- Tests use controlled responses and do not create supplier orders or broadcast transactions.
- The standalone submission package is revalidated with `npm ci`, `npm test` and `npm run build` before handoff.

## Browser and provider verification

- Desktop and 390 px mobile flows were exercised without horizontal overflow.
- A live sample request received responses from TronEnergyRent and the public Energy service documented by JustLend's MCP project. The observed sample was time-specific and is not presented as a lasting price or availability promise.
- Fixture mode reproduced the event-close split, stale-quote invalidation and new allocation without calling external providers.
- Live failure remains explicit and never silently becomes a live-labeled fixture result.

Representative project-owned screenshots:

- [Desktop workspace](bai-desktop.png)
- [Live-source result](bai-live-result.png)
- [Mobile result](bai-mobile-result.png)

## Nile evidence

- Registry deployment transaction: [`7f481964…b091`](https://nile.tronscan.org/#/transaction/7f48196490dccdda47e1ca0166d99c7b9b583d4cc5ea5c3b802838c26fd0b091)
- Registry: [`TSqoRAmu4qviTuscsakTWdYRZQjpiTjP2u`](https://nile.tronscan.org/#/contract/TSqoRAmu4qviTuscsakTWdYRZQjpiTjP2u)
- EnergyDesk receipt: [`956b8f7e…bd9`](https://nile.tronscan.org/#/transaction/956b8f7ea035c816210e6f03a9c97b827069d777a8d26e92b0d6fce6a1a47bd9)
- Independent verifier status: `confirmed`; transaction, owner, Registry, zero value, calldata, event and execution result matched.
- Evidence JSON: [deployment](evidence/registry-deployment.json) and [receipt](evidence/energydesk-receipt.json).

The committed payload uses fixture quote data for repeatability. This proves a test wallet committed the decision digest; it does not prove a supplier order, payment, locked price or Energy delivery.

## Known boundaries

JustLend delivery time and chain reserves are explicit operational assumptions. The system does not inspect a payer's bandwidth, provider prepaid balance or final order screen. A real operator must obtain a final exact-quantity quote and review provider terms before purchasing.

