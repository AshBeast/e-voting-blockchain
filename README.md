# evote-mvp

Version: 1.0.0

> A simple on‑chain e‑voting MVP built with **Hardhat** (contracts, scripts) and a **Vite React** frontend (Voter View + Admin Panel). Optimized for local demos with Hardhat; testnet (Sepolia) notes included at the end. _This project is not complete, in prototype_

---

## Table of Contents

- [Overview](#overview)
- [Requirements](#requirements)
- [Project Layout](#project-layout)
- [Quick Start (copy/paste)](#quick-start-copypaste)
- [Local Dev — Full Walkthrough](#local-dev--full-walkthrough)
  - [1) Start a local blockchain (Hardhat)](#1-start-a-local-blockchain-hardhat)
  - [2) Deploy the contract](#2-deploy-the-contract)
    - [Admin Panel in the UI (deploy + register)](#option-b--admin-panel-in-the-ui-deploy--register)
  - [3) Configure the frontend](#3-configure-the-frontend)
  - [4) Run the frontend](#4-run-the-frontend)
  - [5) Admin Panel — Local mode](#5-admin-panel--local-mode)
  - [6) Voter View — Cast & Verify](#6-voter-view--cast--verify)
  - [7) Common pitfalls & fixes](#7-common-pitfalls--fixes)
- [Smart Contract API](#smart-contract-api)
- [Hardhat Commands](#hardhat-commands)
- [Environment Variables](#environment-variables)
- [Sepolia / MetaMask (Optional)](#sepolia--metamask-optional)
- [License](#license)

---

## Overview

This MVP demonstrates a minimal, auditable vote flow:

- Admin deploys and configures an election (title, candidates, time window).
- Admin registers eligible voter addresses.
- Voters cast one vote each during the open window.
- A **receipt hash** is returned for each vote; voters can verify inclusion without exposing identity or choice.
- **Live tally** is public and updates on each valid vote; voting blocks when the window closes.

## Requirements

- Git and a POSIX shell (macOS/Linux or WSL).
- Node.js 18+ and a package manager (we use **pnpm** in the UI; **npm** also works).
- Hardhat (declared in `package.json`).
- Python is _not_ required unless you add tooling that needs it.

## Project Layout

```
evote-mvp/
  ├─ contracts/         # Voting.sol
  ├─ scripts/           # deploy_and_register.js etc.
  ├─ ignition/          # (if using Hardhat Ignition)
  ├─ evote-ui/          # Vite React frontend (Admin + Voter)
  ├─ hardhat.config.js
  ├─ package.json
  ├─ pnpm-lock.yaml
  └─ README.md
```

---

## Quick Start (copy/paste)

Open **two** terminals side-by-side.

**Terminal A — Hardhat node, Start a local blockchain**

```bash
cd evote-mvp
npx hardhat node
# Leave this running. It prints 20 funded dev accounts with private keys.
```

### 2) Deploy the contract

#### Admin Panel in the UI (deploy + register)

**Terminal B**

```bash
cd evote-mvp/evote-ui
pnpm install
```

Create or update `evote-ui/.env` to point at your local node and contract:

```ini
VITE_RPC_URL=http://127.0.0.1:8545
VITE_LOCAL_RPC=http://127.0.0.1:8545
VITE_LOCAL_CHAIN_ID=31337
VITE_CONTRACT_ADDRESS=<PASTE_CONTRACT_ADDRESS_HERE>
```

### 3) Run the frontend

Termina B

```bash
pnpm dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

### 4) Admin Panel — Local mode

1. Open **Admin Panel** in the UI `http://localhost:5173/admin`.
2. Enable **Use Local Hardhat RPC**.
3. In **Admin Private Key**, paste **Account #0** private key from the Hardhat node output (this will be your admin signer).
4. Fill in:
   - **Title** (e.g., `Vancouver Mayor 2026`)
   - **Candidates** (comma-separated, e.g., `Alice, Bob, Charlie`)
   - **Start / End** (pick a near-future start and a later end)
   - **Eligible Voter Addresses**: paste the 20 **addresses** printed by Hardhat (the textarea auto-extracts addresses).
5. Click **Deploy & Register**.
6. Copy the **new contract address** it prints. If your `.env` had an empty `VITE_CONTRACT_ADDRESS`, paste it now and restart `pnpm dev`.

### 5) Voter View — Cast & Verify

1. Confirm **Status: OPEN**.
2. Use any **registered voter** private key (e.g., Account #1 from Hardhat output).
3. Enter **Candidate Index** (`0` for first candidate, `1` for second, etc.).
4. Click **Cast Vote** → The UI returns a **receipt hash**. Save it.
5. Try to vote again with the same account → you should see “already voted” (by design).
6. Use **Verify Receipt** to check inclusion (returns true/false).
7. After the end time passes, the status becomes **CLOSED** and voting is blocked.

---

## Smart Contract API

Source: `contracts/Voting.sol`

**Admin / Control**

- `registerVoters(address[] addrs)` — _onlyAdmin_
- `closeEarly()` — _onlyAdmin_
- `updateWindow(uint64 startTs, uint64 endTs)` — _onlyAdmin_

**Voting**

- `vote(uint256 optionIndex, bytes32 receipt)` — _inWindow_

**Read / View**

- `candidates() → string[]`
- `candidateCount() → uint256`
- `tally() → uint256[]`
- `hasReceipt(bytes32 receipt) → bool`
- `electionInfo() → (string title, uint64 startTs, uint64 endTs)`
- `status() → string`

**Events**

- `VoterRegistered(address indexed voter)`
- `VoteCast(address indexed voter, bytes32 indexed receipt)`
- `ElectionConfigured(string title, uint64 startTs, uint64 endTs)`

---

## Hardhat Commands

```bash
npx hardhat compile
npx hardhat test
npx hardhat node
```

---

## Diagrams

All diagrams live in `../screenshots/`. If they don’t render on GitHub, double-check the relative path from this README.

### 1) Contract deployment & voter registration (admin flow)

![How to set up election](/screenshots/how%20to%20set%20up%20election-2025-10-12-000524.png)
_Admin deploys `Voting.sol`, network mines the creation tx, then admin registers the allowlist before `startTs`._

### 2) Voting flow (state-changing tx)

![How to vote](/screenshots/how%20to%20vote-2025-10-12-000519.png)
_Registered voter signs `vote(optionIndex, receipt)`; contract checks window/eligibility/duplicate and increments tally._

### 3) Receipt verification (read-only `eth_call`)

![Receipt verification sequence](/screenshots/recipt%20check-2025-10-12-000504.png)
_UI calls `hasReceipt(receipt)` via `eth_call`; the node executes read-only and returns `true|false` (no tx/mining)._

### 4) Live tally & status reads

![Live tally and status reads](/screenshots/live%20tally-2025-10-12-000508.png)
_Frontend periodically calls `status()`, `candidates()`, and `tally()` via `eth_call` to render live results._

---

# HardHat Testing

This repo ships with a structured Hardhat unit test suite that covers deployment, access control, registration, time-window logic, voting, receipt inclusion, and tallying.

```bash
# from repo root
npx hardhat test
```

You should see all suites pass with Mocha output grouped by feature.

## Test Layout

```
test/
  utils/
    voting-helpers.js
  voting.deployment.spec.js
  voting.admin.spec.js
  voting.registration.spec.js
  voting.time.spec.js
  voting.voting.spec.js
  voting.receipts.spec.js
  voting.tally.spec.js
```

## Helpers include:

- `deployElectionFixture()` – deploys Voting.sol with a near-future start and 1-hour window

- `openElection(start) / closeEdgeNudge()` – time travel helpers (Hardhat)

- `makeReceipt(address, optionIndex, nonce)` – computes the vote receipt hash

- `safeReadCandidates() / safeReadTally()` – compatible with function or public-array getters

- `REVERT` – canonical revert strings for consistent assertions

## Focused Runs (by Feature)

### By Suite (file-based)

```bash
# Deployment & configuration
npx hardhat test test/voting.deployment.spec.js

# Admin / access control
npx hardhat test test/voting.admin.spec.js

# Registration
npx hardhat test test/voting.registration.spec.js

# Time window logic
npx hardhat test test/voting.time.spec.js

# Voting behaviors
npx hardhat test test/voting.voting.spec.js

# Receipts: inclusion + replay protection
npx hardhat test test/voting.receipts.spec.js

# Tally aggregation
npx hardhat test test/voting.tally.spec.js

```

### By Suite (grep-based)

```bash
# Deployment & configuration
npx hardhat test --grep "Deployment & Configuration"

# Admin / access control
npx hardhat test --grep "Access Control"

# Registration
npx hardhat test --grep "Registration"

# Time window logic
npx hardhat test --grep "Time Window"

# Voting behaviors
npx hardhat test --grep "Voting.sol – Voting"

# Receipts
npx hardhat test --grep "Receipts"

# Tally
npx hardhat test --grep "Tally"
```

```bash
# only admin tests
npx hardhat test --grep "Access Control"

# time-window tests
npx hardhat test --grep "Time Window"

# a single test (regex supported)
npx hardhat test --grep "rejects out-of-range candidate index"
```

### Individual Tests (exact titles you have)

```bash
# voting.deployment.spec.js
npx hardhat test --grep "stores title, candidates, start/end, and initial status"

# voting.admin.spec.js
npx hardhat test --grep "only admin can register voters"
npx hardhat test --grep "updateWindow allowed before start; blocked after start"
npx hardhat test --grep "closeEarly requires admin and closes after a 1s tick"
npx hardhat test --grep "closeEarly cannot be called twice"
npx hardhat test --grep "updateWindow sanity rejects bad ranges"

# voting.registration.spec.js
npx hardhat test --grep "registers voters and rejects late registration after start"
npx hardhat test --grep "duplicate addresses in the same batch are idempotent"

# voting.time.spec.js
# (use a simple substring to avoid the arrow character)
npx hardhat test --grep "status transitions"
npx hardhat test --grep "rejects votes before start and after end; allows during window"

# voting.voting.spec.js
npx hardhat test --grep "registered voter votes once; receipt stored; tally increments"
npx hardhat test --grep "rejects unregistered voter"
npx hardhat test --grep "rejects out-of-range candidate index at boundary"

# voting.receipts.spec.js
npx hardhat test --grep "records inclusion and prevents replay across accounts"

# voting.tally.spec.js
npx hardhat test --grep "reflects sum across many voters (5 for A, 3 for B)"
```

### Advanced: combine with regex

```bash
# Run Deployment + Admin + Registration together
npx hardhat test --grep "Deployment|Access Control|Registration"

# Run only tests that mention 'closeEarly'
npx hardhat test --grep "closeEarly"

```

## License
