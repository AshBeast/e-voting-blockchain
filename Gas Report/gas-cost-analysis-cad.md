# Gas Cost Analysis and Federal-Scale Estimate (CAD)

## Purpose

This document explains how gas pricing works for this project, gives per-process cost estimates in **Canadian dollars**, and applies the current protocol design to a Canadian federal-election-scale scenario.

It combines:

- basic Ethereum gas and gwei explanation
- current pricing assumptions
- realistic planning assumptions
- per-process cost estimates for this project
- a federal-scale cost and throughput estimate

## 1. Gas and gwei

### What is gas?

On Ethereum, every state-changing action consumes **gas**.

Gas is a measurement of blockchain work. It reflects how much computation and storage a transaction uses.

Examples in this project:

- deploying contracts
- registering voter wallet addresses
- linking a Semaphore identity
- submitting a vote

Read-only calls such as `status()`, `tally()`, `hasReceipt()`, `voteMessage()`, and `voteScope()` are normally done with `eth_call`, so they do **not** cost gas to the UI caller.

### What is gwei?

**Gwei** is the unit used to price gas.

- `1 ETH = 1,000,000,000 gwei`

The core fee formula is:

```text
transaction cost in ETH = gas used × gas price in gwei × 10^-9
```

Then:

```text
transaction cost in CAD = transaction cost in ETH × ETH/CAD price
```

### Example

The real-proof vote baseline measured in this project is:

- `vote()` gas used: `351,520`

At `5 gwei`:

```text
cost in ETH = 351,520 × 5 × 10^-9
            = 0.0017576 ETH
```

Using `ETH/CAD ≈ CA$2,944.67`:

```text
0.0017576 × 2944.67 ≈ CA$5.18
```

So one real-proof vote is approximately:

- `CA$5.18` at `5 gwei`
- `CA$15.53` at `15 gwei`

## 2. Current market snapshot and planning range

### Current snapshot used in this document

As of **April 5, 2026**:

- Ethereum mainnet standard gas was about `0.109 gwei`
- ETH spot price was about `US$2,115.73`
- Bank of Canada USD/CAD rate was `1.3918`
- therefore `ETH/CAD ≈ CA$2,944.67`

This snapshot is real, but it is not a strong budgeting assumption by itself.

### Why the planning range is higher than the current snapshot

The current spot price can be unusually cheap. That is useful for answering:

> What would it cost if I submitted transactions right now?

But it is not a strong basis for answering:

> What cost should I expect for a real deployment plan?

For planning, a more defensible range is:

- `5 gwei` as an optimistic-but-plausible mainnet scenario
- `15 gwei` as a more conservative mainnet scenario

That range is used below for the main interpretation of cost.

## 3. Per-process costs for this project

The following values come from the project’s Hardhat gas reporter and scale benchmarks.

| Process | Gas Used | CAD @ Current Snapshot (0.109 gwei) | CAD @ 5 gwei | CAD @ 15 gwei |
|---|---:|---:|---:|---:|
| Deploy full Semaphore stack + Voting | 15,433,605 | CA$4.95 | CA$227.23 | CA$681.70 |
| Deploy Voting only (reuse existing Semaphore) | 3,455,447 | CA$1.11 | CA$50.88 | CA$152.63 |
| Register one voter (large-benchmark per-voter cost) | 24,348 | CA$0.0078 | CA$0.36 | CA$1.08 |
| Register 250 voters in one batch | 6,087,023 | CA$1.95 | CA$89.62 | CA$268.86 |
| Link one identity | 260,932 | CA$0.0838 | CA$3.84 | CA$11.53 |
| Cast one real-proof vote | 351,520 | CA$0.1128 | CA$5.18 | CA$15.53 |
| Update election window | 34,613 | CA$0.0111 | CA$0.51 | CA$1.53 |
| Close election early | 33,883 | CA$0.0109 | CA$0.50 | CA$1.50 |

### Main interpretation

For a small election or pilot, the most important practical numbers are:

- linking one identity: about `CA$3.84` to `CA$11.53`
- casting one real-proof vote: about `CA$5.18` to `CA$15.53`
- registering one voter: about `CA$0.36` to `CA$1.08`

That means the ongoing election cost is dominated by:

1. identity linking
2. voting

Deployment and admin actions are small by comparison.

## 4. Federal election scale assumptions

To estimate a Canadian federal election, this document uses:

- registered electors: `28,731,275`
- total ballots cast: `19,811,520`

These values come from Elections Canada’s 45th General Election official results totals.

The model assumes:

- all registered electors are allowlisted on-chain
- only actual voters complete identity linking
- only actual ballots cast produce real-proof votes

This is the most realistic national-scale estimate for the **current protocol design**.

## 5. Federal-scale cost estimate

### Realistic federal total

| Scenario | Estimated Total Cost |
|---|---:|
| Current spot snapshot (`0.109 gwei`) | about CA$4.12M |
| `1 gwei` | about CA$37.79M |
| `5 gwei` | about CA$188.95M |
| `15 gwei` | about CA$566.84M |
| `30 gwei` | about CA$1.13B |

### Cost breakdown

| Step | Assumed Count | Gas Per Action | Cost @ 5 gwei | Cost @ 15 gwei |
|---|---:|---:|---:|---:|
| Deploy full Semaphore stack + Voting | 1 | 15,433,605 | CA$227.23 | CA$681.70 |
| Register all electors | 28,731,275 | 24,348 | CA$10.30M | CA$30.90M |
| Link identities for actual ballots cast | 19,811,520 | 260,932 | CA$76.11M | CA$228.34M |
| Cast all ballots with real proofs | 19,811,520 | 351,520 | CA$102.54M | CA$307.61M |
| **Total** | — | — | **CA$188.95M** | **CA$566.84M** |

### Worst-case linking

If every registered elector completed identity linking, not just actual voters, then linking alone would cost:

- about `CA$110.38M` at `5 gwei`
- about `CA$331.14M` at `15 gwei`

## 6. Throughput and time implications

Using the same realistic federal-scale model:

- total gas: `12,833,169,564,345`
- approximate blocks at `30M` gas per block: `427,772`
- approximate time at `12s` block time: `59.4 days`

So even before cost is considered, the current protocol design is not operationally realistic for a federal election on Ethereum mainnet L1.

The problem is both:

- **cost**
- **throughput**

## 7. What is likely in practice?

### For a demo, prototype, local network, or small pilot

The current design is workable.

The costs are measurable, understandable, and acceptable for development and presentation.

### For a real large election

Ethereum mainnet L1 is not a good deployment target for this design.

A more plausible production direction would be:

- an L2
- a permissioned or consortium chain
- or a redesigned protocol with much lower on-chain load

## 8. Overall conclusion

The current Semaphore-based design is technically useful for demonstrating:

- privacy-improved vote authorization
- anonymous group-based proof validation
- receipt inclusion checking
- measurable contract-level costs

However, direct deployment on Ethereum mainnet at Canadian federal-election scale would be prohibitively expensive and throughput-limited.

The most realistic interpretation of the numbers in this document is:

- use the current spot snapshot only as a **point-in-time reference**
- use `5–15 gwei` as the more defensible **planning range**
- treat L1 mainnet as unsuitable for national-scale deployment under the current protocol design

## 9. Supporting files

- [gas-cost-tracker-cad.csv](/Users/ashkanzahed/Desktop/Projects/e-voting/new/e-voting-blockchain/gas-cost-tracker-cad.csv)
- [federal-election-estimate-cad.csv](/Users/ashkanzahed/Desktop/Projects/e-voting/new/e-voting-blockchain/federal-election-estimate-cad.csv)
- [gas-cost-assumptions-cad.csv](/Users/ashkanzahed/Desktop/Projects/e-voting/new/e-voting-blockchain/gas-cost-assumptions-cad.csv)

## 10. Sources

- [Etherscan Gas Tracker](https://etherscan.io/gastracker)
- [CoinGecko Ethereum price](https://www.coingecko.com/en/coins/ethereum)
- [Bank of Canada daily exchange rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/)
- [Elections Canada Official Voting Results Table 3](https://www.elections.ca/res/rep/off/ovrGE45/62/table3E.html)
- [Elections Canada Official Voting Results raw data](https://www.elections.ca/content.aspx?dir=rep%2Foff%2F45gedata&document=index&lang=e&section=res)
