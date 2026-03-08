// election.e2e.spec.js
import { test, expect } from "@playwright/test";
import { pickRandomParticipants } from "./utils/accounts.js";

// Helper: format local datetime string for <input type="datetime-local"> WITH seconds
function toLocalInputString(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const sec = pad(d.getSeconds());
  return `${y}-${m}-${day}T${h}:${min}:${sec}`;
}

// wait that retries + clicks Refresh while the page auto-updates
async function waitForStatus(
  page,
  expected,
  { timeout = 60_000, interval = 1_000 } = {},
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
  let initialVoters = [];
  let extraVoters = [];

  async function adminLoginLocal(page) {
    await page.goto("/admin");
    const localToggle = page.getByTestId("admin-use-local-toggle");
    if (!(await localToggle.isChecked())) await localToggle.check();

    await page.getByTestId("admin-private-key").fill(admin.privateKey);
  }

  // 1) Deploy & register (start/end MUST be in the future)
  test("Deploy & register", async ({ page }) => {
    // Need extra voters to test "register more"
    ({ admin, voters } = pickRandomParticipants({ votersCount: 6 }));
    voter = voters[0];

    // Register first 4 at deploy; add last 2 later
    initialVoters = voters.slice(0, 4);
    extraVoters = voters.slice(4);

    await adminLoginLocal(page);

    // ensure Create tab
    await page.getByTestId("tab-create").click();

    await page.getByTestId("create-title").fill("Vancouver Mayor 2026 - E2E");
    await page.getByTestId("create-candidates").fill("Alice,Bob,Charlie");

    const nowMs = Date.now();

    // Start far enough in the future so we can still do Manage actions safely
    // (we'll move it closer using Update Window test)
    const startDate = new Date(nowMs + 10 * 60_000); // +10 min
    const endDate = new Date(nowMs + 20 * 60_000); // +20 min

    await page.getByTestId("create-start").fill(toLocalInputString(startDate));
    await page.getByTestId("create-end").fill(toLocalInputString(endDate));

    await page
      .getByTestId("create-voters")
      .fill(initialVoters.map((v) => v.address).join("\n"));

    await page.getByTestId("create-deploy-register").click();

    const contractLine = page.getByTestId("create-contract-address");
    await expect(contractLine).toBeVisible({ timeout: 60_000 });
    contractAddress = (await contractLine.textContent())?.trim();
    expect(contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

    await expect(page.getByTestId("create-message")).toContainText(
      /deployed|registered|✅/i,
      { timeout: 60_000 },
    );

    console.log("✅ Deployed contract:", contractAddress);
  });

  // 2) Manage Existing: Register more voters (must be BEFORE start)
  test("Manage: Register more voters (before start)", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await adminLoginLocal(page);

    await page.getByTestId("tab-manage").click();
    await page.getByTestId("manage-contract-address").fill(contractAddress);
    await page.getByTestId("manage-attach").click();

    await expect(page.getByTestId("manage-message")).toContainText(
      /attached/i,
      {
        timeout: 30_000,
      },
    );

    // Register extra voters
    await page
      .getByTestId("manage-more-voters")
      .fill(extraVoters.map((v) => v.address).join("\n"));

    await page.getByTestId("manage-register-more").click();

    await expect(page.getByTestId("manage-message")).toContainText(
      /Registered|additional voters|✅/i,
      { timeout: 60_000 },
    );
  });

  // 3) Manage Existing: Update Window (seconds-level, so tests run fast)
  test("Manage: Update window (seconds-level)", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await adminLoginLocal(page);

    await page.getByTestId("tab-manage").click();
    await page.getByTestId("manage-contract-address").fill(contractAddress);
    await page.getByTestId("manage-attach").click();

    await expect(page.getByTestId("manage-message")).toContainText(
      /attached/i,
      {
        timeout: 30_000,
      },
    );

    const nowMs = Date.now();
    const newStartDate = new Date(nowMs + 10_000); // +10s
    const newEndDate = new Date(nowMs + 80_000); // +80s

    await page
      .getByTestId("manage-new-start")
      .fill(toLocalInputString(newStartDate));
    await page
      .getByTestId("manage-new-end")
      .fill(toLocalInputString(newEndDate));

    await page.getByTestId("manage-update-window").click();

    await expect(page.getByTestId("manage-message")).toContainText(
      /window updated|updated|✅/i,
      { timeout: 60_000 },
    );
  });

  // 4) Open election page (assert OPEN)
  test.setTimeout(120_000);
  test("Open election page", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await page.goto("/");
    await page.getByPlaceholder("0x…").fill(contractAddress);
    await page.getByRole("button", { name: "Open Election" }).click();

    await expect(
      page.getByRole("heading", { name: /Election/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Refresh" }).click();
    await waitForStatus(page, "OPEN", { timeout: 90_000, interval: 1000 });
  });

  // 5) Cast one vote (assert receipt + tally)
  test.setTimeout(120_000);
  test("Vote (assert receipt + tally)", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await page.goto(`/election/${contractAddress}`);
    await waitForStatus(page, "OPEN", { timeout: 90_000, interval: 1000 });

    await page.getByRole("link", { name: "Cast Ballot" }).click();

    await page
      .getByRole("checkbox", { name: /Use Local Hardhat signer/i })
      .check();
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
      {
        timeout: 10_000,
      },
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

  // 6) Double-vote negative (must show duplicate-vote rejection)
  test("Double-vote negative (must show duplicate-vote rejection)", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await page.goto(`/election/${contractAddress}`);
    await page.getByRole("link", { name: "Cast Ballot" }).click();

    await page
      .getByRole("checkbox", { name: /Use Local Hardhat signer/i })
      .check();
    await page.getByLabel("Private Key").fill(voter.privateKey);
    await page.getByLabel("Candidate").selectOption({ value: "1" });
    await page.getByRole("button", { name: "Cast Vote" }).click();

    const errorLocator = page.locator("pre.hint", { hasText: /can't vote twice/i });
    await expect(errorLocator).toBeVisible({ timeout: 10_000 });
    console.log('✅ Double-vote correctly rejected ("can\'t vote twice" visible)');
  });

  // 7) Close early (CLOSED) via Admin → Manage Existing → End Election Now
  test.setTimeout(120_000);
  test("Close early (CLOSED)", async ({ page }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    await adminLoginLocal(page);

    await page.getByTestId("tab-manage").click();
    await page.getByTestId("manage-contract-address").fill(contractAddress);
    await page.getByTestId("manage-attach").click();

    await expect(page.getByTestId("manage-message")).toContainText(
      /attached/i,
      {
        timeout: 30_000,
      },
    );

    const endBtn = page.getByTestId("manage-end-now");
    await expect(endBtn).toBeEnabled({ timeout: 10_000 });
    await endBtn.click();

    // Confirm the admin page processed the tx and reported success
    await expect(page.getByTestId("manage-message")).toContainText(
      /Election ended|closeEarly confirmed|ended/i,
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("manage-end")).not.toHaveText("—", {
      timeout: 30_000,
    });

    await page.goto(`/election/${contractAddress}`);
    await waitForStatus(page, "CLOSED", { timeout: 60_000, interval: 1000 });
    await expect(page.locator("table")).toBeVisible();
  });
});
