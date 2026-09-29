# GWDC 2026 Korea submission

| Field | Value |
|---|---|
| Ecosystem / Challenge | TRON · Challenge A |
| Project | EnergyDesk |
| Repository name | `gwdc-2026-energydesk` |
| Team name | **TODO: team leader** |
| Team leader | **TODO: team leader** |
| Contact email | **TODO: personal submission email** |
| Telegram | **TODO: Telegram handle** |
| Repository URL | <https://github.com/Jimmycoding0301/gwdc-2026-energydesk> |
| Demo video, ≤3 minutes | <https://github.com/Jimmycoding0301/gwdc-2026-energydesk/raw/refs/heads/main/docs/submission/demo.mp4> |
| Pitch deck | <https://github.com/Jimmycoding0301/gwdc-2026-energydesk/raw/refs/heads/main/docs/submission/pitch-deck.pptx> |
| Local demo | `npm ci && npm run dev` → <http://127.0.0.1:5175> |

## Short description

**English:** EnergyDesk compares two real TRON Energy quote sources, normalizes pricing and supply terms, searches single and split procurement plans, explains all costs and invalidates stale allocations before an event-closing payment window.

**中文：** EnergyDesk 对两个真实 TRON Energy 报价源统一单位，比较单家和拆单方案，核对库存、最小单、预算与交付期限，并在报价失效后重新规划。

## Challenge mapping

- Multi-vendor integration: TronEnergyRent plus the public Energy service documented by JustLend's MCP project.
- Comparison: single vendor and two-vendor split search.
- Costs: rental, service, activation, chain reserve and other reserve.

## Evidence and validation

- Registry: <https://nile.tronscan.org/#/contract/TSqoRAmu4qviTuscsakTWdYRZQjpiTjP2u>
- Receipt: <https://nile.tronscan.org/#/transaction/956b8f7ea035c816210e6f03a9c97b827069d777a8d26e92b0d6fce6a1a47bd9>
- Public JSON: [docs/evidence](docs/evidence)
- Clean-package validation: `npm ci` passed; 48 tests passed; production build passed.
- Commands: `npm test`, `npm run build`

## Disclosure

The verified receipt commits a fixture procurement decision. No supplier order, payment, locked price or Energy delivery is claimed. See [HACKATHON_SCOPE.md](HACKATHON_SCOPE.md).

No open-source license has been selected. The public repository is available to reviewers without sign-in.
