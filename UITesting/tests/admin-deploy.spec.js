import { test, expect } from '@playwright/test';
import { pickRandomParticipants } from './utils/accounts.js';

test('admin can deploy election and register voters', async ({ page }) => {
  // pick random admin + 4 voters (deterministic if TEST_SEED is set)
  const { admin, voters } = pickRandomParticipants({ votersCount: 4 });
  console.log(`Using admin: ${admin.address}`);

  // go to admin panel
  await page.goto('/admin');

  // 1 Enable local Hardhat signer
  const localToggle = page.getByLabel('Use Local Hardhat signer');
  if (!(await localToggle.isChecked())) {
    await localToggle.check();
  }

  // 2 Fill admin private key
  await page.getByLabel('Admin Private Key (dev only)').fill(admin.privateKey);

  // 3 Switch to "Create Election" tab (just in case default tab is 'manage')
  await page.getByRole('button', { name: 'Create Election' }).click();

  // 4 Fill out election details
  await page.getByLabel('Title').fill('Vancouver Mayor 2026 - E2E');
  await page.getByLabel('Candidates (comma-separated)').fill('Alice,Bob,Charlie');

  // 5 Fill start/end times
  const now = new Date();
  const start = new Date(now.getTime() + 2 * 60 * 1000).toISOString().slice(0, 16); // 2 min later
  const end = new Date(now.getTime() + 10 * 60 * 1000).toISOString().slice(0, 16);  // +10 min
  await page.getByLabel('Start (local)').fill(start);
  await page.getByLabel('End (local)').fill(end);

  // 6 Fill eligible voters (newline-separated addresses)
  const voterList = voters.map(v => v.address).join('\n');
  await page
    .getByLabel('Eligible Voter Addresses (paste; only addresses are used)')
    .fill(voterList);

  // 7 Deploy & Register
  const deployBtn = page.getByRole('button', { name: 'Deploy & Register' });
  await expect(deployBtn).toBeEnabled();
  await deployBtn.click();

  // 8 Wait for contract address confirmation
  const contractLine = page.locator('b:has-text("Contract:") + span.mono');
  await expect(contractLine).toBeVisible({ timeout: 30_000 });

  const contractAddress = (await contractLine.textContent())?.trim();
  console.log('✅ Deployed contract:', contractAddress);

  // Sanity check: should look like an Ethereum address
  expect(contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

  // Optional: verify success message in .hint
  const hint = await page.locator('.hint.pre').textContent();
  expect(hint || '').toMatch(/success|deployed|registered/i);
});
