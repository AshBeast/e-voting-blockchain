# evote-mvp

Version: 1.2.0

A simple on-chain e-voting MVP built with **Hardhat** (contracts, scripts) and a **Vite React** frontend (Voter View + Admin Panel). Optimized for local demos with Hardhat; testnet (Sepolia) support and a hosted UI are also available. _This project is not complete, it is a prototype._

---

## Table of Contents

- [Overview](#overview)
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
- [License](#license)

---

## Overview

This MVP demonstrates a minimal, auditable vote flow:

- Admin deploys and configures an election (title, candidates, time window).
- Admin registers eligible voter addresses.
- Voters cast one vote each during the open window.
- A **receipt hash** is returned for each vote; voters can verify inclusion without exposing identity or choice.
- **Live tally** is public and updates on each valid vote; voting blocks when the window closes.

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
2. **Voters** go to `https://evote.donkloud.ca`, paste the contract address, attach to the election, and cast ballots using MetaMask.
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
cd evote-mvp
npx hardhat node
# Leave this running. It prints 20 funded dev accounts with private keys.
```

### 2) Install UI deps

**Terminal B**

```bash
cd evote-mvp/evote-ui
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

### 4) Admin Panel — Local mode

1. Open **Admin Panel** in the UI: `http://localhost:5173/admin`.
2. Enable **Use Local Hardhat signer**.
3. In **Admin Private Key**, paste **Account #0** private key from the Hardhat node output (this will be your admin signer).
4. Fill in:
   - **Title** (e.g., `Vancouver Mayor 2026`)
   - **Candidates** (comma-separated, e.g., `Alice, Bob, Charlie`)
   - **Start / End** (pick a near-future start and a later end)
   - **Eligible Voter Addresses**: paste the 20 **addresses** printed by Hardhat (the textarea auto-extracts addresses).
5. Click **Deploy & Register**.
6. Copy the **new contract address** it prints. If your `.env.local` had an empty `VITE_CONTRACT_ADDRESS`, paste it now and restart `pnpm dev`.

### 5) Voter View — Cast & Verify

1. On the root page (`/`), paste the contract address and open the election.
2. Confirm **Status: OPEN**.
3. Use any **registered voter** private key (e.g., Account #1 from Hardhat output).
4. Select a candidate by name.
5. Click **Cast Vote** → The UI returns a **receipt hash**. Save it.
6. Try to vote again with the same account → you should see an “already voted” error (by design).
7. Use the **Check Receipt** page to verify inclusion (returns true/false).
8. After the end time passes, the status becomes **CLOSED** and voting is blocked.

> **On Sepolia with MetaMask:**  
> When running against Sepolia (either via the hosted UI or `pnpm dev --mode sepolia`), leave any “Use Local Hardhat signer” option **unchecked**. The app will use your injected wallet (MetaMask) to sign `vote()` transactions, and you do **not** paste private keys into the page.

---

## Smart Contract API

Source: `contracts/Voting.sol`

### Admin / Control

- `registerVoters(address[] addrs)` — _onlyAdmin_
- `closeEarly()` — _onlyAdmin_
- `updateWindow(uint64 startTs, uint64 endTs)` — _onlyAdmin_

### Voting

- `vote(uint256 optionIndex, bytes32 receipt)` — _inWindow_

### Read / View

- `candidates() → string[]`
- `candidateCount() → uint256`
- `tally() → uint256[]`
- `hasReceipt(bytes32 receipt) → bool`
- `electionInfo() → (string title, uint64 startTs, uint64 endTs)`
- `status() → string`

### Events

- `VoterRegistered(address indexed voter)`
- `VoteCast(address indexed voter, bytes32 indexed receipt)`
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
4. Voters open the root URL, paste the contract address, attach to the election, and use MetaMask to sign `vote()` transactions.

### 2) Local UI in Sepolia mode

If you want to run the UI locally but still talk to Sepolia:

1. Create `evote-ui/.env.sepolia` as described above.
2. Run:

   ```bash
   cd evote-mvp/evote-ui
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
_Registered voter signs `vote(optionIndex, receipt)`; contract checks window/eligibility/duplicate and increments tally._

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
  voting.deployment.spec.js
  voting.admin.spec.js
  voting.registration.spec.js
  voting.time.spec.js
  voting.voting.spec.js
  voting.receipts.spec.js
  voting.tally.spec.js
```

### Helpers include:

- `deployElectionFixture()` – deploys `Voting.sol` with a near-future start and 1-hour window.
- `openElection(start) / closeEdgeNudge()` – time travel helpers (Hardhat).
- `makeReceipt(address, optionIndex, nonce)` – computes the vote receipt hash.
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
npx hardhat test --grep "registered voter votes once; receipt stored; tally increments"
npx hardhat test --grep "rejects unregistered voter"
npx hardhat test --grep "rejects out-of-range candidate index at boundary"

# voting.receipts.spec.js
npx hardhat test --grep "records inclusion and prevents replay across accounts"

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

This suite drives the real web UI against a local Hardhat node to prove the full flow end-to-end.

### What the tests cover

1. **Deploy & Register (Admin panel)**

   - Toggles local signer → fills title/candidates → sets start/end → pastes allowlist → Deploy & Register.
   - Captures and validates the contract address.

2. **Open Election (Voter view)**

   - Opens `/` → pastes address → Open Election → waits until `Status: OPEN` (helper `waitForStatus()` taps **Refresh** while the page auto-updates).

3. **Cast One Vote (receipt + tally)**

   - Navigates to **Cast Ballot** → fills voter private key (local mode) → picks candidate → **Cast Vote**.
   - Extracts receipt hash, verifies inclusion on **Check Receipt**, then confirms tally shows the vote.

4. **Double-Vote Negative**

   - Attempts a second vote from the same wallet → expects “already voted”.

5. **Close (CLOSED)**
   - Admin attaches the existing contract → **End Election Now**.
   - Election page shows `Status: CLOSED`; tally remains visible/final.

### Helper functions in the test

- `toLocalInputString()` – formats `<input type="datetime-local">` values.
- `waitForStatus(page, "OPEN" | "CLOSED")` – polls the Status row and taps **Refresh** until it matches.

### Pre-run checklist

- Hardhat node is running (`npx hardhat node`, keep it open).
- UI dev server is running (Vite, usually at `http://localhost:5173`).
- UI Admin panel supports “Use Local Hardhat signer”.
- Your Playwright config’s `baseURL` points to the UI dev server (e.g., `http://localhost:5173`).

### Install & run

```bash
# from Playwright project root (UITesting/)
pnpm exec playwright install

# run just this E2E file
TEST_SEED=1 pnpm exec playwright test tests/election.e2e.spec.js

# show HTML report after a run
pnpm exec playwright show-report
```

### Debugging tips

```bash
# Open Playwright Inspector (headed, pausing at each action)
PWDEBUG=1 TEST_SEED=1 pnpm exec playwright test tests/election.e2e.spec.js
```

**Notes**

- If Status doesn’t flip as expected during demos, keep **Refresh** visible: the helper `waitForStatus()` will keep tapping it while the page’s own auto-update detects the start/end time.
- Ensure date/time fields are valid local times; the helper `toLocalInputString()` formats them correctly.
- If you change any button/label text in the UI, update the test locators to match (they use accessible names like “Open Election”, “Cast Vote”, “End Election Now”).

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
