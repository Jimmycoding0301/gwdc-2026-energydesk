# ReceiptRegistry deployment

Deploy `ReceiptRegistry.sol` once on **TRON Nile** with Solidity `0.8.20`, optimizer enabled, and `200` runs. Verify the same source and settings on Nile TRONSCAN, then start EnergyDesk with its real Base58 address:

```sh
NILE_RECEIPT_REGISTRY_ADDRESS=T... npm run dev
```

The submission's `.env.example` contains the public Registry already used for the confirmed demo receipt. If the variable is removed or changed to an invalid address, the evidence panel stays in `deploy_required` and cannot open a wallet signature request. `TRON_RECEIPT_REGISTRY_ADDRESS` remains a backward-compatible alias.

This source is the shared canonical append-only event registry used by the TRON projects. It stores no funds and exposes no mutation other than emitting a receipt event. Keep [`compiler-settings.json`](compiler-settings.json) unchanged so one verified Nile deployment can be reused across projects.

The shared ABI is:

```solidity
function commit(bytes32 kind, bytes32 digest) external;
event ReceiptCommitted(address indexed submitter, bytes32 indexed kind, bytes32 digest, uint256 timestamp);
```

EnergyDesk passes SHA-256(`energydesk.procurement-decision.v1`) as `kind` and SHA-256(canonical receipt JSON) as `digest`. The call sends `0` TRX. The verifier reads the transaction body and solidified receipt directly from fixed Nile RPC endpoints and checks the calldata plus event.
