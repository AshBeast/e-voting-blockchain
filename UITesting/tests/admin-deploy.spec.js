import { test, expect } from "@playwright/test";
import { pickRandomParticipants } from "./utils/accounts.js";

const LOCAL_RPC_URL = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:8787";
const FORCED_SEMAPHORE = process.env.PLAYWRIGHT_SEMAPHORE_ADDRESS || "";
let relayerAddress = "";
let reusableSemaphore = "";

function toLocalInputString(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

test("admin can deploy election and register voters (local)", async ({ page }) => {
  test.setTimeout(2 * 60_000);
  const { admin, voters } = pickRandomParticipants({ votersCount: 4 });

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

  await page.getByTestId("tab-create").click();
  await page.getByTestId("create-title").fill("Admin Deploy Smoke - E2E");
  await page.getByTestId("create-candidate-0").fill("Alice");
  await page.getByTestId("create-candidate-1").fill("Bob");

  const now = Date.now();
  await page.getByTestId("create-start").fill(toLocalInputString(new Date(now + 2 * 60_000)));
  await page.getByTestId("create-end").fill(toLocalInputString(new Date(now + 10 * 60_000)));
  await page.getByLabel("Relayer Address").fill(relayerAddress);
  if (reusableSemaphore) {
    await page
      .getByLabel("Semaphore Address (optional, auto-deploy if empty)")
      .fill(reusableSemaphore);
  }
  await page.getByTestId("create-voters").fill(voters.map((v) => v.address).join("\n"));

  await page.getByTestId("create-deploy-register").click();
  await expect(page.getByTestId("create-message")).not.toHaveText(/^\s*$/, { timeout: 15_000 });

  const contractLine = page.getByTestId("create-contract-address");
  await expect(contractLine).toBeVisible({ timeout: 120_000 });

  const contractAddress = (await contractLine.textContent())?.trim();
  expect(contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  await expect(page.getByTestId("create-message")).toContainText(/deployed|registered|✅/i, {
    timeout: 120_000,
  });
});

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
