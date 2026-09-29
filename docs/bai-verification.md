# Warm-white UI and intake verification

Verified 2026-09-28, local frontend 5175 / API 8789. No orders, signatures or payments were made.

## Automated

`npm test`: 34 tests passing in 2 files. `npm run build`: TypeScript and Vite production build passed.

The added tests cover checksum-only address intake without network access; fixed confirmed-node RPC and transaction-ID binding; integer 15% suggestion rounding and limits; missing/failed/mismatched receipts; rate-limit/network/schema errors without fixture fallback; Express input validation; selected-plan brief contents, source timestamps and expired/changed snapshot warnings.

## Actual public reads

The confirmed mainnet block endpoint returned block 86,641,142. A successful contract transaction from it was queried through the new `/api/lookup` route:

- Transaction: `9e1969dd60cf3e94c4e368dcaed8d64231f521ff75661943623e2cf8326c0e8e`.
- `receipt.energy_usage_total`: 64,285.
- Editable planning draft: 73,928 E, using `ceil(64,285 × 1.15)`.
- UI kept the original 130,000 E until “采用建议数量” was clicked, then displayed 73,928 E.
- A subsequent real comparison returned both providers successfully and recommended JustLend at 2.961408 TRX including 0.3 TRX per-order reserve. This is a historical observation, not a current price promise.

## Browser

Desktop 1440 × 1000 and mobile 390 × 844 were inspected. Mobile document width was 390 with no horizontal overflow, including the historical draft, result and manual-copy fallback.

- Address paste handler: dispatched a browser ClipboardEvent and observed checksum-validated address notice and recipient fill. This verifies the paste event path; the native OS clipboard shortcut was not tested.
- TRX preset: filled 0 E and showed the Bandwidth explanation. Clicking compare displayed a clear local warning and created no report.
- USDT preset: filled 65,000 E and showed the editable-starting-point caveat.
- Real history draft: displayed actual usage and 15% buffer separately, with source, block and timestamp.
- Copy: success label followed a successful clipboard write. A deliberately rejected browser write showed the full manual-copy textarea, selection action and close action; mobile screenshot included.
- Fixture regression: 130,000 E → split 5.1 TRX; simulated stock change invalidated the original plan and recommended the 6.15 TRX single provider.
- Browser error panel was empty during the tested application flows. A later clipboard permission probe and redeclared evaluation variable failed only within test commands, not application code.

Screenshots:

- `bai-desktop.png`: fresh desktop homepage.
- `bai-history-desktop.png`: history draft.
- `bai-live-result.png`: actual provider comparison and copied brief.
- `bai-mobile-history.png`: 390px history draft.
- `bai-mobile-result.png`: 390px split result.
- `bai-mobile-copy-fallback.png`: 390px visible clipboard failure and manual copy.

## Boundaries

15% buffer and scenario quantities are planning assumptions, not live transaction simulation. Historical usage does not guarantee the next transaction's need. Live RPC failures remain explicit and do not become demo data. Presets, history adoption and copying never create an order. Public endpoints may rate-limit or change schema; those cases are covered by local tests.
