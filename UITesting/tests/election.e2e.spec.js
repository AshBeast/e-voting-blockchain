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

test.describe
  .serial("Full Election E2E via App.jsx → ElectionPage → VotePage", () => {
  let contractAddress = null;
  let admin, voters, voter;

  test("Admin deploys election & registers voters (window OPEN now)", async ({
    page,
  }) => {
    // Choose random participants (set TEST_SEED for reproducibility)
    ({ admin, voters } = pickRandomParticipants({ votersCount: 4 }));
    voter = voters[0];

    // Go to admin panel (route assumed from your earlier admin UI)
    await page.goto("/admin");

    // Enable dev signer
    const localToggle = page.getByLabel("Use Local Hardhat signer");
    if (!(await localToggle.isChecked())) await localToggle.check();

    // Admin key
    await page
      .getByLabel("Admin Private Key (dev only)")
      .fill(admin.privateKey);

    // Ensure "Create Election" tab
    await page.getByRole("button", { name: "Create Election" }).click();

    // Fill election details
    await page.getByLabel("Title").fill("Vancouver Mayor 2026 - E2E");
    await page
      .getByLabel("Candidates (comma-separated)")
      .fill("Alice,Bob,Charlie");

    // Make the election OPEN *now* (start slightly in the past)
    const now = new Date();

    // +1 hour +1 minute offset for display
    const offset = (hours, minutes) => (hours * 60 + minutes) * 60 * 1000;

    const startLocal = toLocalInputString(
      new Date(now.getTime() - offset(1 - 1, -1))
    ); // effectively now - 1h + 1m
    const endLocal = toLocalInputString(
      new Date(now.getTime() + offset(2 + 1, 1))
    ); // now + 3h + 1m

    await page.getByLabel("Start (local)").fill(startLocal);
    await page.getByLabel("End (local)").fill(endLocal);

    // Eligible voters (newline-separated)
    await page
      .getByLabel("Eligible Voter Addresses (paste; only addresses are used)")
      .fill(voters.map((v) => v.address).join("\n"));

    // Deploy
    await page.getByRole("button", { name: "Deploy & Register" }).click();

    // Wait for "Contract: <span.mono>" line
    const contractLine = page.locator('b:has-text("Contract:") + span.mono');
    await expect(contractLine).toBeVisible({ timeout: 30_000 });
    contractAddress = (await contractLine.textContent())?.trim();
    expect(contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

    // Optional success text in the hint area
    const hint = await page.locator(".hint.pre").textContent();
    expect(hint || "").toMatch(/deployed|success|registered/i);

    console.log("✅ Deployed contract:", contractAddress);
  });

  test("Open election via App.jsx and cast a vote via VotePage.jsx", async ({
    page,
  }) => {
    test.skip(!contractAddress, "No contract deployed from previous test");

    // Go to App.jsx (root)
    await page.goto("/");

    // Fill the contract address in the "0x…" input and open
    await page.getByPlaceholder("0x…").fill(contractAddress);
    await page.getByRole("button", { name: "Open Election" }).click();

    // ElectionPage.jsx should load; verify key bits render
    await expect(
      page.getByRole("heading", { name: /Election/i })
    ).toBeVisible();
    // Status should eventually reflect OPEN because we set start < now
    // ElectionPage.jsx should load; verify key bits render
    await expect(
      page.getByRole("heading", { name: /Election/i })
    ).toBeVisible();

    // (optional) nudge the page once so the status refreshes quickly
    await page.getByRole("button", { name: "Refresh" }).click();

    // Target ONLY the "Status:" row, not all .kv rows
    const statusRow = page.locator(".kv").filter({ hasText: /^Status:/ });

    // Wait until it shows OPEN (ElectionPage auto-refreshes every 4s)
    await expect(statusRow).toContainText("OPEN", { timeout: 20_000 });

    // Go to VotePage via link
    await page.getByRole("link", { name: "Cast Ballot" }).click();

    // VotePage.jsx: fill Private Key (label exists exactly as "Private Key")
    await page.getByLabel("Private Key").fill(voter.privateKey);

    // Select Candidate #0 (the first option in <select>)
    await page.getByLabel("Candidate").selectOption({ value: "0" });

    // Cast vote
    const castBtn = page.getByRole("button", { name: "Cast Vote" });
    await expect(castBtn).toBeEnabled();
    await castBtn.click();

    // The <pre class="hint"> contains "✅ Vote confirmed.\nReceipt:\n0x...".
    const receiptPre = page.locator("pre.hint");
    await expect(receiptPre).toContainText(/Vote confirmed/i, {
      timeout: 20_000,
    });
    await expect(receiptPre).toContainText(/0x[a-fA-F0-9]{64}/);

    // Extract receipt hex
    const preText = await receiptPre.innerText();
    const receipt = (preText.match(/0x[a-fA-F0-9]{64}/) || [])[0];
    expect(receipt).toBeTruthy();
    console.log("🧾 Receipt:", receipt);

    // Navigate back to election page, refresh, and expect tally shows at least 1 for candidate 0
    await page.getByRole("link", { name: "Back to Election" }).click();
    await page.getByRole("button", { name: "Refresh" }).click();

    // make sure table rendered
    await expect(page.locator("table")).toBeVisible();

    // target row 0 and each cell
    const row0 = page.locator("tbody tr").first();
    const idxCell = row0.locator("td").nth(0);
    const nameCell = row0.locator("td").nth(1);
    const votesCell = row0.locator("td").nth(2);

    // ensure correct index/name cells
    await expect(idxCell).toHaveText(/^0$/);
    await expect(nameCell).toContainText(/Alice/i);

    // refresh once (your page also auto-refreshes every 4s)
    await page.getByRole("button", { name: "Refresh" }).click();

    // wait until votes become 1 (or greater, if you later run multiple votes)
    await expect(votesCell).toHaveText(/^1$/, { timeout: 20_000 });
    // If you prefer "at least 1":
    // await expect(votesCell).toHaveText(/^[1-9]\d*$/, { timeout: 20_000 });
  });
});
