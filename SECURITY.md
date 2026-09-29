# Security policy

## Reporting

Use GitHub private vulnerability reporting or a private Security Advisory after publication. Do not place secrets or exploit details in a public issue.

## Wallet and network safety

- EnergyDesk never needs a private key. TronLink performs user-visible signing in the browser.
- Use a dedicated Nile test wallet with no mainnet assets.
- Verify Nile, the connected account, Registry address, zero call value, fee limit, kind and digest before signing.
- A broadcast response is not final proof; the app only confirms after the Solidity RPC transaction, receipt and event match.

## Data boundary

Live quote endpoints can observe ordinary request metadata and the recipient address used for quoting. Fixture receipts contain synthetic business data. Do not import confidential production data into this prototype.

This local hackathon prototype does not place supplier orders and has not received a production security audit.

