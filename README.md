# evote-mvp (Semaphore ZK)

Version: 1.2.0

A simple on-chain e-voting MVP built with **Hardhat** (contracts, scripts) and a **Vite React** frontend (Voter View + Admin Panel). Optimized for local demos with Hardhat; testnet (Sepolia) support and a hosted UI are also available. _This project is not complete, it is a prototype._

---

## Table of Contents

- [Overview](#overview)
- [What Changed In `ui-changes`](#what-changed-in-ui-changes)
- [Hosted Demo (Sepolia)](#hosted-demo-sepolia)
- [Requirements](#requirements)
- [Project Layout](#project-layout)
- [Quick Start (copy/paste)](#quick-start-copypaste)
- [Smart Contract API](#smart-contract-api)
- [Hardhat Commands](#hardhat-commands)
- [Environment Variables](#environment-variables)
- [Sepolia / MetaMask (Optional)](#sepolia--metamask-optional)
- [Diagrams](#diagrams)
- [HardHat Testing](#hardhat-testing)
- [Playwright (End-to-End UI Tests)](#playwright-end-to-end-ui-tests)
- [Milestone 1 — Completed Deliverables](#milestone-1--completed-deliverables)
- [Milestone 2 — Completed Deliverables](#milestone-2--completed-deliverables)
- [Milestone 3 — Completed Deliverables](#milestone-3--completed-deliverables)
- [Milestone 4 — Completed Deliverables](#milestone-4--completed-deliverables)
- [License](#license)

---

## Overview

This MVP demonstrates a minimal, auditable, privacy-improved vote flow:

- Admin deploys and configures an election (title, candidates, time window, relayer, Semaphore).
- Admin registers eligible voter wallet addresses.
- Voter performs a one-time private identity link (`linkIdentity`) for that election.
- Voter casts a gasless vote through a relayer using a Semaphore zero-knowledge proof.
- A **receipt hash** is returned for each vote; voters can verify inclusion without exposing wallet-to-choice linkage.
- **Live tally** is public and updates on each valid vote; voting blocks when the window closes.

### What Changed In `ui-changes`

- Top navigation + responsive layout across Home/Admin/Watchdog/Election routes.
- Theme support (including dark mode) with consistent component styling.
- Home page now lists discovered elections from the relayer registry with pagination.
- Admin page now has dedicated tabs:
  - `Create Election`
  - `Manage Existing`
  - `My Elections`
- Admin create/manage voter inputs now support CSV import (`address` column or raw address text).
- Watchdog table now has pagination and improved mobile behavior.
- Added standalone pages for:
  - `Link Identity`
  - `Cast Ballot`
  - `Check Receipt`
  - `Live Tally` (TV-style view)

---

## Hosted Demo (Sepolia)

A hosted build of the UI is available on Sepolia:

- Voter View: https://evote.donkloud.ca
- Admin Panel: https://evote.donkloud.ca/admin

Requirements:

- MetaMask (or another injected wallet) installed.
- Wallet configured for the **Sepolia** test network.
- Some Sepolia test ETH in the admin and voter accounts.

Usage (high level):

1. **Admin** goes to `https://evote.donkloud.ca/admin`, leaves “Use Local Hardhat signer” **unchecked** so the app uses MetaMask, configures an election, and clicks **Deploy & Register** on Sepolia.
2. **Voters** go to `https://evote.donkloud.ca`, paste the contract address, attach to the election, and cast ballots. The wallet signs identity/proof inputs while the relayer submits on-chain vote txs.
3. Everyone can see the **live tally** and use the **Check Receipt** page to verify inclusion of a receipt hash on-chain.

---

## Requirements

- Git and a POSIX shell (macOS/Linux or WSL).
- Node.js 18+ and a package manager (we use **pnpm** in the UI; **npm** also works).
- Hardhat (declared in `package.json`).
- Python is _not_ required unless you add tooling that needs it.

---

## Project Layout

```text
E-VOTING-BLOCKCHAIN/
├─ e-voting/                 # Hardhat project (contracts + unit tests)
│  ├─ contracts/
│  ├─ scripts/
│  ├─ test/
├─ evote-ui/                 # Vite React frontend (Admin + Voter)
│  ├─ public/
│  ├─ relayer/               # Relayer is here
│  ├─ src/
│  ├─ eslint.config.js
│  ├─ index.html
├─ UITesting/                # Playwright E2E (drives the real UI)
│  ├─ fixtures/
│  ├─ playwright-report/
│  ├─ test-results/
│  ├─ tests/
├─ screenshots/
└─ README.md
```

---

## Quick Start (copy/paste)

Open **two** terminals side-by-side.

### 1) Start a local blockchain (Hardhat)

**Terminal A — Hardhat node**

```bash
cd e-voting
npx hardhat node
# Leave this running. It prints 20 funded dev accounts with private keys.
```

### 2) Install UI deps

**Terminal B**

```bash
cd evote-ui
pnpm install
```

Create or update `evote-ui/.env.local` to point at your local node and (optionally) a contract:

```ini
VITE_RPC_URL=http://127.0.0.1:8545
VITE_LOCAL_RPC=http://127.0.0.1:8545
VITE_LOCAL_CHAIN_ID=31337
VITE_CONTRACT_ADDRESS=<PASTE_CONTRACT_ADDRESS_HERE_OR_LEAVE_EMPTY>
```

If `VITE_CONTRACT_ADDRESS` is empty, you’ll paste the address into the UI after deploying.

### 3) Run the frontend

Still in **Terminal B**:

```bash
pnpm dev
```

For local Hardhat dev, `pnpm dev` uses `.env` / `.env.local` by default.

To run the UI wired to Sepolia (using `.env.sepolia`), use:

```bash
pnpm dev --mode sepolia
```

Vite will then load `.env.sepolia` (and `.env.sepolia.local` if present) instead of the default env file set.

Open the URL printed by Vite (usually `http://localhost:5173`).

### 4) Start the relayer (Gasless ZK voting)
Open a new **Terminal C**

1. Create a relayer env file at:

`evote-ui/relayer/.env.local`
example:
```bash
RELAYER_PORT=8787
RELAYER_RPC_URL=http://127.0.0.1:8545
RELAYER_PRIVATE_KEY=0x<RELAYER_FUNDED_PRIVATE_KEY>
```
2. Start the relayer:
```bash
cd evote-ui/relayer
node -r dotenv/config server.cjs dotenv_config_path=.env.local
```

You should see logs like:
- `Relayer listening on http://localhost:8787`
- `RPC: ...`
- `Relayer address: 0x...`



### 5) Admin Panel — Local mode

1. Open **Admin Panel** in the UI: `http://localhost:5173/admin`.
2. Enable **Use Local Hardhat signer**.
3. In **Admin Private Key**, paste **Account #0** private key from the Hardhat node output (this will be your admin signer).
4. In the `Create Election` tab, fill in:
   - **Title** (e.g., `Vancouver Mayor 2026`)
   - **Candidates** (separate candidate rows; add/remove as needed)
   - **Start / End** (pick a near-future start and a later end)
   - **Eligible Voter Addresses**: paste addresses or import CSV.
5. Enter **Relayer Address** (required).
6. Leave **Semaphore Address** empty to auto-deploy Poseidon + SemaphoreVerifier + Semaphore (or paste an existing deployed Semaphore address).
7. Click **Deploy & Register**.
8. Copy the **new contract address** it prints.
9. In `Manage Existing`, attach any election to:
   - update window (before start),
   - register additional voters (before start),
   - update relayer,
   - close early.

### 6) Voter View — Link, Cast & Verify

1. On the root page (`/`), paste the contract address and open the election.
2. During **PENDING**, open **Link Identity** and complete one-time identity linking.
3. Once status is **OPEN**, open **Cast Ballot**, choose a candidate, and submit.
4. The UI returns a **receipt hash**. Save it.
5. Try to vote again with the same account/identity -> you should see `can't vote twice`.
6. Use **Check Receipt** to verify on-chain inclusion.
7. Use **Live Tally** for a dedicated full-screen tally page.
8. After end time (or `closeEarly`), status becomes **CLOSED** and voting is blocked.

> **On Sepolia with MetaMask:**  
> When running against Sepolia (either via the hosted UI or `pnpm dev --mode sepolia`), leave any “Use Local Hardhat signer” option **unchecked**. The app uses MetaMask for identity/link signatures, while the relayer pays gas for on-chain `linkIdentity(...)` and `vote(...)`.

---

## Smart Contract API

Source: `contracts/Voting.sol`

### Admin / Control

- `registerVoters(address[] addrs)` — _onlyAdmin_
- `closeEarly()` — _onlyAdmin_
- `updateWindow(uint64 startTs, uint64 endTs)` — _onlyAdmin_
- `updateRelayer(address newRelayer)` — _onlyAdmin_

### Identity Link (one-time per wallet per election)

- `linkPayloadHash(address voter, uint256 identityCommitment, uint256 expiry) → bytes32`
- `linkIdentity(address voter, uint256 identityCommitment, uint256 expiry, bytes signature)` — _onlyRelayer_

### Voting (ZK, gasless via relayer)

- `voteMessage(uint256 optionIndex, bytes32 receipt) → uint256`
- `vote(uint256 optionIndex, ISemaphore.SemaphoreProof proof, bytes32 receipt)` — _onlyRelayer + inWindow_

### Read / View

- `admin() → address`
- `relayer() → address`
- `semaphore() → address`
- `semaphoreGroupId() → uint256`
- `voteScope() → uint256`
- `registered(address) → bool`
- `hasLinkedIdentity(address) → bool`
- `linkedIdentityCommitment(address) → uint256`
- `candidates() → string[]`
- `candidateCount() → uint256`
- `tally() → uint256[]`
- `hasReceipt(bytes32 receipt) → bool`
- `groupRoot() → uint256`
- `groupDepth() → uint256`
- `groupSize() → uint256`
- `electionInfo() → (string title, uint64 startTs, uint64 endTs)`
- `status() → string`

### Events

- `VoterRegistered(address indexed voter)`
- `IdentityLinked(uint256 indexed identityCommitment)`
- `VoteCast(bytes32 indexed receipt)`
- `RelayerUpdated(address indexed relayer)`
- `ElectionConfigured(string title, uint64 startTs, uint64 endTs)`

---

## Hardhat Commands

From the Hardhat project folder (`e-voting/`):

```bash
npx hardhat compile
npx hardhat test
npx hardhat node
```

---

## Environment Variables

The UI supports two main modes via Vite’s `--mode` flag:

- **Local dev (Hardhat)** – default mode, talks to `http://127.0.0.1:8545`
- **Sepolia testnet** – `--mode sepolia`, talks to an Infura (or other) Sepolia RPC

Vite loads env files in this order:

- `.env`
- `.env.local`
- `.env.<mode>`
- `.env.<mode>.local`

### Local Hardhat – `evote-ui/.env.local`

For local development against `npx hardhat node`:

```ini
# evote-ui/.env.local

VITE_RPC_URL=http://127.0.0.1:8545
VITE_LOCAL_RPC=http://127.0.0.1:8545
VITE_LOCAL_CHAIN_ID=31337
VITE_CONTRACT_ADDRESS=<local_deployed_contract_address_or_empty>
```

Run:

```bash
pnpm dev
```

### Sepolia – `evote-ui/.env.sepolia`

For testnet / “prod-like” builds (Sepolia):

```ini
# evote-ui/.env.sepolia

VITE_RPC_URL=https://sepolia.infura.io/v3/<YOUR_INFURA_KEY>
VITE_CHAIN_ID=11155111
VITE_CONTRACT_ADDRESS<sepolia_deployed_contract_address>

# optional: keep local values for dev helpers
VITE_LOCAL_RPC=http://127.0.0.1:8545
VITE_LOCAL_CHAIN_ID=31337
```

Run in Sepolia mode:

```bash
# dev server
pnpm dev --mode sepolia

# production build
pnpm build --mode sepolia
```

---

## Sepolia / MetaMask (Optional)

You can run the same MVP on the Sepolia testnet in two ways.

### 1) Hosted UI (recommended for quick demos)

- Admin: https://evote.donkloud.ca/admin
- Voters: https://evote.donkloud.ca

Steps:

1. Switch MetaMask to **Sepolia** and ensure you have test ETH.
2. As admin, open `/admin`, leave “Use Local Hardhat signer” **unchecked**, fill in the election details + voter addresses, and click **Deploy & Register**.
3. Share the contract address with voters.
4. Voters open the root URL, paste the contract address, attach to the election, and use MetaMask to sign identity/link inputs while relayer submits vote txs.

### 2) Local UI in Sepolia mode

If you want to run the UI locally but still talk to Sepolia:

1. Create `evote-ui/.env.sepolia` as described above.
2. Run:

   ```bash
   cd evote-ui
   pnpm dev --mode sepolia
   ```

3. The flows are the same as the hosted UI, except you’re serving the React app from your machine.

---

## Diagrams

All diagrams live in `./screenshots/`. If they don’t render on GitHub, double-check the relative path from this README.

### 1) Contract deployment & voter registration (admin flow)

![How to set up election](/screenshots/how%20to%20set%20up%20election-2025-10-12-000524.png)  
_Admin deploys `Voting.sol`, network mines the creation tx, then admin registers the allowlist before `startTs`._

### 2) Voting flow (state-changing tx)

![How to vote](/screenshots/how%20to%20vote-2025-10-12-000519.png)  
_Registered voter performs one-time link (if needed), browser generates a Semaphore proof, relayer submits `vote(optionIndex, proof, receipt)`, contract validates proof and increments tally._

### 3) Receipt verification (read-only `eth_call`)

![Receipt verification sequence](/screenshots/recipt%20check-2025-10-12-000504.png)  
_UI calls `hasReceipt(receipt)` via `eth_call`; the node executes read-only and returns `true|false` (no tx/mining)._

### 4) Live tally & status reads

![Live tally and status reads](/screenshots/live%20tally-2025-10-12-000508.png)  
_Frontend periodically calls `status()`, `candidates()`, and `tally()` via `eth_call` to render live results._

---

## HardHat Testing

This repo ships with a structured Hardhat unit test suite that covers deployment, access control, registration, time-window logic, voting, receipt inclusion, and tallying.

```bash
# from Hardhat project root (e-voting/)
npx hardhat test
```

You should see all suites pass with Mocha output grouped by feature.

### Test Layout

```text
test/
  utils/
    voting-helpers.js
    snark-artifacts.js
  voting.deployment.spec.js
  voting.admin.spec.js
  voting.registration.spec.js
  voting.time.spec.js
  voting.voting.spec.js
  voting.receipts.spec.js
  voting.tally.spec.js
  voting.zk.integration.spec.js
```

### Helpers include:

- `deployElectionFixture()` – deploys `Voting.sol` with a near-future start and 1-hour window.
- `openElection(start) / closeEdgeNudge()` – time travel helpers (Hardhat).
- `makeReceipt(randomBytes32)` – normalizes a 32-byte receipt value.
- `safeReadCandidates() / safeReadTally()` – compatible with function or public-array getters.
- `REVERT` – canonical revert strings for consistent assertions.

### Focused Runs (by Feature)

#### By Suite (file-based)

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

# Real Semaphore proof integration (may skip if snark artifacts are unavailable)
npx hardhat test test/voting.zk.integration.spec.js
```

#### By Suite (grep-based)

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

#### Individual Tests (exact titles you have)

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
npx hardhat test --grep "linked identity votes once; receipt stored; tally increments"
npx hardhat test --grep "rejects link from unregistered voter"
npx hardhat test --grep "rejects out-of-range candidate index at boundary"

# voting.receipts.spec.js
npx hardhat test --grep "records inclusion and prevents receipt replay"

# voting.tally.spec.js
npx hardhat test --grep "reflects sum across many voters (5 for A, 3 for B)"
```

#### Advanced: combine with regex

```bash
# Run Deployment + Admin + Registration together
npx hardhat test --grep "Deployment|Access Control|Registration"

# Run only tests that mention 'closeEarly'
npx hardhat test --grep "closeEarly"
```

---

## Playwright (End-to-End UI Tests)

`UITesting/` covers the local ZK flow end-to-end against your running Hardhat node + relayer.

### Current suite coverage

- Deploy election + initial registration.
- Register additional voters from `Manage Existing`.
- Link identity during `PENDING`.
- Update window to open soon.
- Cast vote + verify receipt + tally update.
- Confirm double-vote rejection.
- Close early.
- Validate watchdog event visibility + pagination controls.

### Pre-run checklist

- Hardhat node is running on `127.0.0.1:8545`.
- Relayer is running on `localhost:8787`.
- UI dev server is reachable at `http://127.0.0.1:5173` (Playwright starts it by default unless already running).

### Commands

```bash
cd UITesting

# list tests
pnpm test:list

# full local election suite
pnpm test:e2e

# deploy/register smoke test
pnpm test:smoke

# html report
pnpm exec playwright show-report
```

### Debugging

```bash
# focused debug for the update window path
pnpm exec playwright test tests/election.e2e.spec.js -g "Manage: update window to open soon" --debug
```

### Notes

- Tests force local signer mode (`admin.useLocal` / `vote.useLocal`) to avoid flaky toggle behavior.
- If the app is changed to new labels/selectors, update test locators in `UITesting/tests/*.spec.js`.

---

## Milestone 1 — Completed Deliverables

- Date: **November 2025**
- Goal: Establish a working foundation of the blockchain voting system with verified rules, a functional UI, and automated tests.

### What was completed

- **Smart Contract (`Voting.sol`)** — fully implemented and audited through Hardhat unit tests covering access control, registration, voting, receipt validation, and tallying.
- **Unit Testing (Hardhat + Mocha/Chai)** — all tests passing; average `vote()` execution ≈ 90k gas; confirms one-vote-per-voter and correct state transitions.
- **Frontend UI (Vite + React)** — Admin Panel and Voter View pages built; includes live tally display, receipt verification, and automatic status updates.
- **End-to-End Testing (Playwright)** — MVP E2E suite verifying the full election lifecycle: deploy → register → vote → verify → close.
- **Bug fixes + UX polish** — fixed refresh/status timing issue; UI now updates automatically when election start/end times are reached.
- **Documentation updates** — expanded README with test instructions, run commands, project layout, and local/testnet setup notes.

## Milestone 2 — Completed Deliverables

- Date: **December 2025**
- Goal: Demonstrate the MVP on a public Ethereum-compatible test network and publish a hosted UI that anyone with MetaMask and test ETH can use.

### What was completed

- **Testnet Deployment (Sepolia)** — extended the Hardhat configuration and environment files to support Sepolia, including RPC URL, chain ID, and a funded admin private key loaded from `.env.sepolia`.
- **MetaMask Integration** — updated the Admin and Voter flows so that, when local mode is disabled, all transactions (deploy, register, vote) are signed through an injected wallet (MetaMask) instead of a pasted dev key.
- **Environment Modes (`--mode`)** — configured Vite to switch between local Hardhat and Sepolia setups via `pnpm dev --mode sepolia`, using `.env.sepolia` for testnet RPC and contract address.
- **Hosted UI (evote.donkloud.ca)** — built and deployed the React frontend to a public server:
  - Voter View: `https://evote.donkloud.ca`
  - Admin Panel: `https://evote.donkloud.ca/admin`
    Users with MetaMask on Sepolia can attach to the live contract, cast votes, and verify receipts directly in the browser.
- **End-to-End Testnet Demo** — recorded and validated a full testnet walkthrough: connect MetaMask → deploy election on Sepolia → register voters → cast ballots from multiple accounts → verify receipts → observe live tally.
- **Readme / Setup Updates** — documented Sepolia-specific env variables, MetaMask network requirements, and how to run the UI in both local (`pnpm dev`) and testnet (`pnpm dev --mode sepolia`) modes.

### Summary

Milestone 2 moves the system from a local-only prototype to a publicly accessible testnet deployment.  
The same `Voting.sol` contract and React client now run on Sepolia, with MetaMask handling real transaction signing and a hosted frontend at `evote.donkloud.ca`. This demonstrates that the architecture works in a realistic, decentralized environment and sets the stage for future milestones on scaling, kiosk mode, and UAT.

---

## Milestone 3 — Completed Deliverables

- Date: **January–February 2026**
- Goal: Harden the system and add gasless voting using an EIP-2771 forwarder + relayer, while keeping the local demo flow fully testable end-to-end.

### What was completed

- **Gasless Voting (EIP-2771)** — implemented OpenZeppelin `ERC2771Forwarder` (`Forwarder.sol`) plus a Node/Express relayer that accepts EIP-712 typed-data signatures, verifies the request (`verify()`), and submits `execute()` while paying gas.
- **EIP-2771-Aware Voting Contract** — updated `Voting.sol` to use `_msgSender()` and accept a `trustedForwarder` in the constructor so votes are attributed to the voter (not the relayer).
- **End-to-End Local Flow** — local Hardhat now supports both vote paths:
  - **Direct vote** (local private key mode), and
  - **Gasless vote** (MetaMask signs → relayer pays gas).
- **Playwright E2E Coverage** — core election lifecycle tests pass end-to-end (deploy → register → vote → verify receipt → close).
- **Admin Ops Exercised** — validated admin operations (`updateWindow`, `closeEarly`) through the UI and tests so elections can be adjusted or ended early.
- **Audit Layer (Explorer Links)** — added UI affordances to support auditability (links to transactions/events on explorers) so observers can verify on-chain activity without manual log inspection.

---

## Milestone 4 — Completed Deliverables

- Date: **March 2026**
- Goal: Migrate privacy from forwarder-based gasless voting to Semaphore zero-knowledge voting, and clean up deprecated forwarder paths.

### What was completed

- Added:
  - `ISemaphore` integration, per-election Semaphore group, and `voteScope`.
  - `linkIdentity(voter, identityCommitment, expiry, signature)`.
  - `vote(optionIndex, proof, receipt)` with `semaphore.validateProof(...)`.
  - Events `IdentityLinked(identityCommitment)` and `VoteCast(receipt)`.
  - Relayer API routes for ZK linking and ZK voting.
- Removed (legacy forwarder path):
  - OpenZeppelin `ERC2771Forwarder` contract and old forwarder artifacts.
  - Legacy forwarder helper code in the UI (`gaslessVote.js`).
  - Old admin UI component tied to forwarder deployment.

### ZK Migration Details (Behavioral Differences)

- **Vote privacy improvement**: old flow exposed `voter + optionIndex` linkage directly (`VoteCast(voter, receipt)` plus clear calldata). New flow emits `VoteCast(receipt)` and validates anonymous membership via Semaphore proof.
- **One-time identity bootstrap**: each registered wallet links one commitment once per election, then votes privately with proof; this separates public wallet registration from private ballot casting.
- **Relayer trust reduction**: relayer can submit txs and pay gas, but cannot silently change candidate choice because proof message is bound to `voteMessage(optionIndex, receipt)`.
- **Duplicate vote handling**: old model relied on `hasVoted[address]`; new model relies on Semaphore nullifier uniqueness (same identity cannot produce two valid votes for the same scope).
- **Operational cleanup**: forwarder contract/artifacts/helpers were removed to avoid dead paths and confusion in production/testnet runs.
