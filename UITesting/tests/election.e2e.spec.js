import { test, expect } from "@playwright/test";
import { pickRandomParticipants } from "./utils/accounts.js";

// Helper: format local datetime string for <input type="datetime-local">
function toLocalInputString(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

// wait that retries + clicks Refresh while the page auto-updates
async function waitForStatus(
  page,
  expected,
  { timeout = 60_000, interval = 1_000 } = {}
) {
  const statusRow = page.locator(".kv").filter({ hasText: /^Status:/ });
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const txt = (await statusRow.textContent()) || "";
    if (txt.includes(expected)) return;
    const refreshBtn = page.getByRole("button", { name: "Refresh" });
    if (await refreshBtn.isVisible().catch(() => false))
      await refreshBtn.click();
    await page.waitForTimeout(interval);
  }
  throw new Error(`Status did not become ${expected} within ${timeout}ms`);
}

test.describe
  .serial("Full Election E2E via App.jsx → ElectionPage → VotePage", () => {
  let contractAddress = null;
  let admin, voters, voter;

  // 1) Deploy & register
  test("Deploy & register", async ({ page }) => {
    ({ admin, voters } = pickRandomParticipants({ votersCount: 4 }));
    voter = voters[0];

    await page.goto("/admin");

    const localToggle = page.getByLabel("Use Local Hardhat signer");
    if (!(await localToggle.isChecked())) await localToggle.check();
//
    await page
      .getByLabel("Admin Private Key (dev only)")
      .fill(admin.privateKey);

    await page.getByRole("button", { name: "Create Election" }).click();

    await page.getByLabel("Title").fill("Vancouver Mayor 2026 - E2E");
    await page
      .getByLabel("Candidates (comma-separated)")
      .fill("Alice,Bob,Charlie");

    const now = new Date();
    const offset = (hours, minutes) => (hours * 60 + minutes) * 60 * 1000;

    const startLocal = toLocalInputString(
      new Date(now.getTime() - offset(1 - 1, -1))
    ); // keep your logic
    const endLocal = toLocalInputString(
      new Date(now.getTime() - offset(1 - 1, -2))
    ); // keep your logic

    await page.getByLabel("Start (local)").fill(startLocal);
    await page.getByLabel("End (local)").fill(endLocal);

    await page
      .getByLabel("Eligible Voter Addresses (paste; only addresses are used)")
      .fill(voters.map((v) => v.address).join("\n"));

    await page.getByRole("button", { name: "Deploy & Register" }).click();

    const contractLine = page.locator('b:has-text("Contract:") + span.mono');
    await expect(contractLine).toBeVisible({ timeout: 60_000 });
    contractAddress = (await contractLine.textContent())?.trim();
    expect(contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

    const hint = await page.locator(".hint.pre").textContent();
    expect(hint || "").toMatch(/deployed|success|registered/i);

    console.log("✅ Deployed contract:", contractAddress);
  });

  // 2) Open election page (assert OPEN)
  test.setTimeout(120_000);
  test("Open election page", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await page.goto("/");
    await page.getByPlaceholder("0x…").fill(contractAddress);
    await page.getByRole("button", { name: "Open Election" }).click();

    await expect(
      page.getByRole("heading", { name: /Election/i })
    ).toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await waitForStatus(page, "OPEN", { timeout: 60_000, interval: 1000 });
  });

  // 3) Cast one vote (assert receipt + tally)
  test.setTimeout(120_000);
  test("Cote (assert receipt + tally)", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await page.goto(`/election/${contractAddress}`);
    await waitForStatus(page, "OPEN", { timeout: 60_000, interval: 1000 });

    await page.getByRole("link", { name: "Cast Ballot" }).click();

    await page.getByRole('checkbox', { name: 'Use Local Hardhat signer (' }).check();
    await page.getByLabel("Private Key").fill(voter.privateKey);
    await page.getByLabel("Candidate").selectOption({ value: "0" });

    const castBtn = page.getByRole("button", { name: "Cast Vote" });
    await expect(castBtn).toBeEnabled();
    await castBtn.click();

    const receiptPre = page.locator("pre.hint");
    await expect(receiptPre).toContainText(/Vote confirmed/i, {
      timeout: 20_000,
    });
    await expect(receiptPre).toContainText(/0x[a-fA-F0-9]{64}/);

    const preText = await receiptPre.innerText();
    const receipt = (preText.match(/0x[a-fA-F0-9]{64}/) || [])[0];
    expect(receipt).toBeTruthy();
    console.log("🧾 Receipt:", receipt);

    // Check Receipt
    await page.getByRole("link", { name: "Back to Election" }).click();
    await page.getByRole("link", { name: /Check Receipt/i }).click();
    await page.getByLabel(/Receipt/i).fill(receipt);
    await page.getByRole("button", { name: /Check|Verify/i }).click();
    await expect(page.locator("body")).toContainText(
      /Included|true|verified/i,
      { timeout: 10_000 }
    );

    // Back & assert tally
    await page
      .getByRole("link", { name: /Back to Election|Election/i })
      .click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("table")).toBeVisible();

    const row0 = page.locator("tbody tr").first();
    const idxCell = row0.locator("td").nth(0);
    const nameCell = row0.locator("td").nth(1);
    const votesCell = row0.locator("td").nth(2);

    await expect(idxCell).toHaveText(/^0$/);
    await expect(nameCell).toContainText(/Alice/i);
    await expect(votesCell).toHaveText(/^1$/, { timeout: 20_000 });
  });

  // 4) Double-vote negative (must show “already voted”)
  test("Double-vote negative (must show 'already voted')", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await page.goto(`/election/${contractAddress}`);
    await page.getByRole("link", { name: "Cast Ballot" }).click();

    await page.getByRole('checkbox', { name: 'Use Local Hardhat signer (' }).check();
    await page.getByLabel("Private Key").fill(voter.privateKey);
    await page.getByLabel("Candidate").selectOption({ value: "1" });
    await page.getByRole("button", { name: "Cast Vote" }).click();

    const errorLocator = page.locator("pre.hint", {
      hasText: /already voted/i,
    });
    await expect(errorLocator).toBeVisible({ timeout: 10_000 });
    console.log('✅ Double-vote correctly rejected ("already voted" visible)');
  });

  // 5) Close (CLOSED)
  test.setTimeout(120_000);
  test("Close (CLOSED)", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await page.goto("/admin");
    const toggle = page.getByLabel("Use Local Hardhat signer");
    if (!(await toggle.isChecked())) await toggle.check();
    await page
      .getByLabel("Admin Private Key (dev only)")
      .fill(admin.privateKey);

    await page.getByRole("button", { name: "Manage Existing" }).click();
    await page.getByLabel("Contract Address").fill(contractAddress);
    await page.getByRole("button", { name: /Attach/i }).click();

    const endBtn = page.getByRole("button", { name: "End Election Now" });
    await expect(endBtn).toBeEnabled({ timeout: 10_000 });
    await endBtn.click();

    await page.goto(`/election/${contractAddress}`);
    await waitForStatus(page, "CLOSED", { timeout: 60_000, interval: 1000 });
    await expect(page.locator("table")).toBeVisible();
  });
});
