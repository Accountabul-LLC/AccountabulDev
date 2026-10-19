# Palisade / Ripple Treasury Pilot

Research current as of August 25, 2026.

## Decision

Treat Ripple Wallet-as-a-Service (Palisade) as a candidate **treasury and wallet-control layer**, not as the viewer-facing crypto checkout. Current official documentation verifies self-custody MPC wallets, policies, approvals, signed webhooks, transaction monitoring, freezes, and sweeping. It does not verify merchant checkout pages, crypto invoices, payer QR codes, exchange-rate locks, payer KYC, refunds, or fiat settlement.

Recommended path:

```text
viewer
  → separate crypto checkout/quote processor
  → Accountabul payment ledger
  → processor settlement
  → Palisade-managed treasury wallet
```

Do not enable production crypto until Ripple confirms in writing that Accountabul's exact US third-party tipping/treasury model is permitted and counsel approves the flow.

## Verified capabilities

- Ripple acquired Palisade in 2025 and now documents it as Wallet-as-a-Service.
- Production WaaS uses MPC; CloudSign supports server-side signing and mixed human/automated approval quorums.
- Wallets begin deposit-only. Outgoing activity requires policies, approved destinations, and explicit enablement.
- `externalId` supports idempotent resource creation.
- Webhooks use P-256 ECDSA signatures; delivery order is not guaranteed, so handlers need signature checks, replay protection, and monotonic reconciliation.
- Mainnet coverage includes Ethereum/EVM networks, Bitcoin, Solana, Tron, and XRP Ledger, subject to Accountabul's enabled asset registry.
- Scheduled sweeping can consolidate assets, but sweep transactions bypass normal wallet transaction policies and therefore require separate privileged controls and monitoring.

Primary sources:

- [Ripple acquisition announcement](https://ripple.com/ripple-press/ripple-acquires-palisade-to-offer-comprehensive-digital-asset-custody-solution/)
- [Ripple Wallet-as-a-Service overview](https://docs.ripple.com/products/wallet)
- [Getting started and MPC requirements](https://docs.ripple.com/products/wallet/getting-started/getting-started)
- [API walkthrough](https://docs.ripple.com/products/wallet/getting-started/getting-started-api)
- [Blockchains and tokens](https://docs.ripple.com/products/wallet/user-interface/blockchains-and-tokens)
- [External IDs](https://docs.ripple.com/products/wallet/user-interface/transactions/external-ids)
- [Webhook integration overview](https://docs.ripple.com/products/wallet/user-interface/integrations/overview)
- [Webhook signature verification](https://docs.ripple.com/products/wallet/user-interface/integrations/manage-webhooks)
- [Sweeping guide](https://docs.ripple.com/products/wallet/admin-guide/configure-asset-sweeping)
- [Ripple compliance disclosures](https://ripple.com/legal/compliance/)

## Sandbox acceptance criteria

1. Ripple provides a dedicated Accountabul sandbox organization and written eligibility for the described flow.
2. At least two MPC devices, separated owner/proposer/approver/auditor roles, least-privilege API credentials, and credential rotation are demonstrated.
3. Repeated wallet creation with one Accountabul `externalId` produces no duplicate.
4. One stablecoin path and one native-asset path complete checkout through the separate processor and settle to the intended Palisade wallet.
5. Accountabul can trace `tip ID → processor payment ID → settlement ID → Palisade transaction/wallet ID → chain hash` without relying on amount matching.
6. Invalid signatures, duplicate and out-of-order webhooks, provider timeouts, frozen deposits, and rejected transactions remain safe and never duplicate credit.
7. An above-limit withdrawal and unapproved destination are blocked; an allowed transfer requires the configured quorum.
8. A sandbox sweep reaches the correct treasury wallet, exposes insufficient-fee failure clearly, and can be disabled through a documented kill switch.
9. Recovery keys, S3/KMS ownership, restore procedure, vendor exit, pricing, SLA, RTO/RPO, insurance, asset/network IDs, and production limits are documented.
10. Legal, sanctions, AML/KYT, custody, money-transmission, tax, refund, and consumer-disclosure owners approve launch.

`DisabledCryptoCheckoutAdapter` remains the application default until every criterion passes.
