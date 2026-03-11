// election.e2e.spec.js
import { test, expect } from "@playwright/test";
import { pickRandomParticipants } from "./utils/accounts.js";

const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:8787";
const LOCAL_RPC_URL = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
const FORCED_SEMAPHORE = process.env.PLAYWRIGHT_SEMAPHORE_ADDRESS || "";

function toLocalInputString(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normText(v) {
  return (v || "").replace(/\s+/g, " ").trim();
}

function extractReceiptHash(voteMessageText) {
  const text = voteMessageText || "";
  const labeled = text.match(/Receipt:\s*(0x[a-fA-F0-9]{64})/i);
  if (labeled?.[1]) return labeled[1];

  // Fallback: if formatting changes, choose the last 32-byte hex in the message,
  // because tx hash is printed before receipt in current UI.
  const all = [...text.matchAll(/0x[a-fA-F0-9]{64}/g)].map((m) => m[0]);
  return all.length > 0 ? all[all.length - 1] : "";
}

async function waitForStatus(page, expected, { timeout = 90_000, interval = 1000 } = {}) {
  const statusRow = page
    .locator(".kv")
    .filter({ has: page.locator("b", { hasText: "Status:" }) })
    .first();

  const started = Date.now();
  while (Date.now() - started < timeout) {
    const txt = normText(await statusRow.textContent());
    if (txt.toUpperCase().includes(expected.toUpperCase())) return;

    const refreshBtn = page.getByRole("button", { name: /Refresh/i }).first();
    const canClickRefresh =
      (await refreshBtn.isVisible().catch(() => false)) &&
      (await refreshBtn.isEnabled().catch(() => false));
    if (canClickRefresh) {
      await refreshBtn.click();
    }
    await page.waitForTimeout(interval);
  }

  throw new Error(`Status did not become ${expected} within ${timeout}ms`);
}

async function adminLoginLocal(page, admin) {
  await page.goto("/admin");
  await page.evaluate(() => {
    localStorage.setItem("admin.useLocal", "1");
  });
  await page.reload();

  const localToggle = page.getByTestId("admin-use-local-toggle");
  for (let i = 0; i < 3; i++) {
    if (await localToggle.isChecked()) break;
    try {
      await localToggle.setChecked(true, { force: true, timeout: 3000 });
    } catch {
      await page.locator(".admin-switch-track").first().click({ force: true });
    }
    await page.waitForTimeout(250);
  }
  await expect(localToggle).toBeChecked({ timeout: 5000 });

  const keyField = page.getByTestId("admin-private-key");
  await expect(keyField).toBeVisible({ timeout: 5000 });
  await keyField.fill(admin.privateKey);
}

async function forceVoteLocalMode(page) {
  await page.evaluate(() => {
    localStorage.setItem("vote.useLocal", "1");
  });

  const toggle = page.locator(".vote-mode-inline .admin-switch-input").first();
  for (let i = 0; i < 3; i++) {
    if (await toggle.isChecked()) break;
    try {
      await toggle.setChecked(true, { force: true, timeout: 3000 });
    } catch {
      await page.locator(".vote-mode-inline .admin-switch-track").first().click({ force: true });
    }
    await page.waitForTimeout(250);
  }
  await expect(toggle).toBeChecked({ timeout: 5000 });
  await expect(page.locator(".vote-mode-chip")).toContainText(/Local signer/i);
}

async function attachManage(page, contractAddress) {
  await page.getByTestId("tab-manage").click();
  await page.getByTestId("manage-contract-address").fill(contractAddress);
  await page.getByTestId("manage-attach").click();
  await expect(page.getByTestId("manage-details")).toBeVisible({ timeout: 45_000 });
}

async function enableLocalVoteMode(page, privateKey) {
  await forceVoteLocalMode(page);
  await page.getByLabel("Private Key").fill(privateKey);
}

test.describe.serial("Local full E2E (zk flow + watchdog)", () => {
  let contractAddress = "";
  let admin;
  let voters;
  let voter;
  let initialVoters = [];
  let extraVoters = [];
  let receipt = "";
  let relayerAddress = "";
  let reusableSemaphore = "";

  test.beforeAll(async ({ request }) => {
    const rpc = await request.post(LOCAL_RPC_URL, {
      timeout: 10_000,
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      },
    });
    expect(rpc.ok(), `Local RPC not reachable at ${LOCAL_RPC_URL}`).toBeTruthy();

    const health = await request.get(`${RELAYER_URL}/health`, { timeout: 10_000 });
    expect(health.ok(), `Relayer not reachable at ${RELAYER_URL}`).toBeTruthy();
    const body = await health.json();
    expect(body?.relayer, "Relayer health response missing relayer address").toMatch(
      /^0x[a-fA-F0-9]{40}$/
    );
    relayerAddress = body.relayer;

    if (/^0x[a-fA-F0-9]{40}$/.test(FORCED_SEMAPHORE)) {
      reusableSemaphore = FORCED_SEMAPHORE;
    }
  });

  test("Deploy & register initial voters", async ({ page }) => {
    test.setTimeout(2 * 60_000);

    ({ admin, voters } = pickRandomParticipants({ votersCount: 6 }));
    voter = voters[0];
    initialVoters = voters.slice(0, 4);
    extraVoters = voters.slice(4);

    await adminLoginLocal(page, admin);
    await page.getByTestId("tab-create").click();

    await page.getByTestId("create-title").fill("Vancouver Mayor 2026 - ZK E2E");
    await page.getByTestId("create-candidate-0").fill("Alice");
    await page.getByTestId("create-candidate-1").fill("Bob");

    const now = Date.now();
    const start = new Date(now + 45 * 60_000); // keep pending long enough for full suite
    const end = new Date(now + 75 * 60_000);

    await page.getByTestId("create-start").fill(toLocalInputString(start));
    await page.getByTestId("create-end").fill(toLocalInputString(end));
    await page.getByLabel("Relayer Address").fill(relayerAddress);
    if (reusableSemaphore) {
      await page
        .getByLabel("Semaphore Address (optional, auto-deploy if empty)")
        .fill(reusableSemaphore);
    }
    await page.getByTestId("create-voters").fill(initialVoters.map((v) => v.address).join("\n"));

    await page.getByTestId("create-deploy-register").click();
    await expect(page.getByTestId("create-message")).not.toHaveText(/^\s*$/, { timeout: 15_000 });

    await expect(page.getByTestId("create-contract-address")).toBeVisible({ timeout: 120_000 });
    contractAddress = normText(await page.getByTestId("create-contract-address").textContent());
    expect(contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

    await expect(page.getByTestId("create-message")).toContainText(/deployed|registered|✅/i, {
      timeout: 120_000,
    });
  });

  test("Manage: register more voters (before start)", async ({ page }) => {
    test.skip(!contractAddress, "No deployed contract address");
    await adminLoginLocal(page, admin);
    await attachManage(page, contractAddress);

    await page.getByTestId("manage-more-voters").fill(extraVoters.map((v) => v.address).join("\n"));
    await page.getByTestId("manage-register-more").click();

    const registerCard = page.locator("section.admin-subcard", {
      has: page.getByRole("heading", { name: /Register More Voters/i }),
    });
    await expect(registerCard.locator(".hint.pre")).toContainText(/registered|✅|tx/i, {
      timeout: 90_000,
    });
  });

  test("Link identity during PENDING", async ({ page }) => {
    test.skip(!contractAddress, "No deployed contract address");

    await page.goto(`/election/${contractAddress}`);
    await waitForStatus(page, "PENDING", { timeout: 30_000 });

    await page.getByRole("link", { name: /Link Identity/i }).click();
    await expect(page.getByRole("heading", { name: /Link Identity/i })).toBeVisible();

    await enableLocalVoteMode(page, voter.privateKey);

    await page.getByRole("button", { name: /Link Identity Now|Linking Closed/i }).click();
    await expect(page.locator("pre.vote-msg-box")).toContainText(/identity linked|already linked|✅/i, {
      timeout: 120_000,
    });
  });

  test("Manage: update window to open soon", async ({ page }) => {
    test.skip(!contractAddress, "No deployed contract address");

    await adminLoginLocal(page, admin);
    await attachManage(page, contractAddress);

    const now = Date.now();
    const newStart = new Date(now + 45_000);
    const newEnd = new Date(now + 6 * 60_000);

    await page.getByTestId("manage-new-start").fill(toLocalInputString(newStart));
    await page.getByTestId("manage-new-end").fill(toLocalInputString(newEnd));
    await page.getByTestId("manage-update-window").click();

    const windowCard = page.locator("section.admin-subcard", {
      has: page.getByRole("heading", { name: /Update Window/i }),
    });
    const windowMsg = windowCard.locator(".hint.pre");
    await expect(windowMsg).not.toHaveText(/^\s*$/, { timeout: 90_000 });
    await expect
      .poll(async () => ((await windowMsg.textContent()) || "").trim(), {
        timeout: 90_000,
      })
      .toMatch(
        /updated|window updated|✅|confirm|already started|before start|pending|cannot update|start passed|closed|❌/i
      );

    const txt = (await windowMsg.textContent()) || "";
    const normalized = txt.toLowerCase();

    if (/(updated|window updated|✅|confirm)/i.test(normalized)) return;

    // If update misses the pre-start window under debugger slowness, allow if election is already OPEN.
    if (
      /(already started|before start|pending|cannot update|start passed|closed)/i.test(normalized)
    ) {
      await page.goto(`/election/${contractAddress}`);
      await waitForStatus(page, "OPEN", { timeout: 90_000 });
      return;
    }

    throw new Error(`Unexpected update-window result: ${txt}`);
  });

  test("Vote + receipt + total votes update", async ({ page }) => {
    test.skip(!contractAddress, "No deployed contract address");

    await page.goto(`/election/${contractAddress}`);
    await waitForStatus(page, "OPEN", { timeout: 120_000 });

    await page.getByRole("link", { name: /Cast Ballot/i }).click();
    await expect(page.getByRole("heading", { name: /Cast Ballot/i })).toBeVisible();

    await enableLocalVoteMode(page, voter.privateKey);
    await page.getByRole("button", { name: /Cast Vote/i }).click();

    const votePre = page.locator("pre.vote-msg-box");
    await expect(votePre).toContainText(/Vote relayed privately|receipt|✅/i, { timeout: 120_000 });
    const voteText = await votePre.innerText();
    receipt = extractReceiptHash(voteText);
    expect(receipt).toMatch(/^0x[a-fA-F0-9]{64}$/);

    await page.getByRole("link", { name: /Back to Election/i }).click();
    await page.getByRole("link", { name: /Check Receipt/i }).click();
    await page.getByLabel(/Receipt/i).fill(receipt);
    await page.getByRole("button", { name: /Check Receipt|Check/i }).click();
    await expect(page.locator("body")).toContainText(/Found on-chain|included|✅/i, {
      timeout: 30_000,
    });

    await page.getByRole("link", { name: /Back to Election/i }).click();
    await page.getByRole("button", { name: /Refresh/i }).click();
    await expect
      .poll(async () => normText(await page.locator("section.card").nth(1).textContent()), {
        timeout: 30_000,
      })
      .toMatch(/Total Votes:\s*1/i);
  });

  test("Double-vote is rejected", async ({ page }) => {
    test.skip(!contractAddress, "No deployed contract address");

    await page.goto(`/election/${contractAddress}/vote`);
    await enableLocalVoteMode(page, voter.privateKey);

    await page.getByLabel("Candidate").selectOption({ value: "1" });
    await page.getByRole("button", { name: /Cast Vote/i }).click();

    await expect(page.locator("pre.vote-msg-box")).toContainText(
      /can't vote twice|already voted|nullifier|duplicate/i,
      { timeout: 40_000 }
    );
  });

  test("Close early -> CLOSED", async ({ page }) => {
    test.skip(!contractAddress, "No deployed contract address");

    await adminLoginLocal(page, admin);
    await attachManage(page, contractAddress);

    await page.getByTestId("manage-end-now").click();

    const emergencyCard = page.locator("section.admin-subcard-danger");
    await expect(emergencyCard.locator(".hint.pre")).toContainText(/ended|closeearly|✅/i, {
      timeout: 90_000,
    });

    await page.goto(`/election/${contractAddress}`);
    await waitForStatus(page, "CLOSED", { timeout: 60_000 });
  });

  test("Watchdog shows audit events (local)", async ({ page }) => {
    test.skip(!contractAddress, "No deployed contract address");

    await page.goto(`/watchdog/${contractAddress}`);
    await expect(page.getByRole("heading", { name: /Watchdog Audit Trail/i })).toBeVisible();

    await page.getByRole("button", { name: /Load from 0/i }).click();
    await expect(page.locator(".watchdog-table")).toBeVisible({ timeout: 45_000 });

    // Core events from this run should be visible.
    await expect(page.locator("body")).toContainText(/IdentityLinked/i, { timeout: 45_000 });
    await expect(page.locator("body")).toContainText(/VoteCast/i, { timeout: 45_000 });
    await expect(page.locator("body")).toContainText(/VoterRegistered/i, { timeout: 45_000 });

    // Pagination controls present for large lists.
    await expect(page.locator(".watchdog-pagination")).toBeVisible();
  });
});
