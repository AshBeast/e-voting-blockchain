// tests/utils/accounts.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function seedRandom(seed) {
  // simple seeded RNG using crypto createHmac; returns function 0..1
  let i = 0;
  return (max = 1) => {
    i++;
    const h = crypto.createHmac('sha256', String(seed)).update(String(i)).digest('hex');
    const n = parseInt(h.slice(0, 12), 16) / 0xffffffffffff;
    return n * max;
  };
}

export function loadAccounts() {
  const p = path.resolve(process.cwd(), 'fixtures', 'accounts.json');
  const pExample = path.resolve(process.cwd(), 'fixtures', 'accounts.example.json');
  const filepath = fs.existsSync(p) ? p : pExample;
  const raw = fs.readFileSync(filepath, 'utf8');
  const obj = JSON.parse(raw);
  return obj.accounts || obj;
}

/**
 * Pick random admin + voters.
 * @param {object} opts
 *  - votersCount: number of voters to return (default 3)
 *  - seed: optional seed (string or number) for reproducible picks (env TEST_SEED)
 */
export function pickRandomParticipants({ votersCount = 3, seed = process.env.TEST_SEED } = {}) {
  const accounts = loadAccounts();
  const rng = seed ? seedRandom(seed) : Math.random;
  const adminIndex = Math.floor(rng(accounts.length));
  const admin = accounts[adminIndex];

  // pick unique random voters excluding admin
  const voters = [];
  const indices = new Set([adminIndex]);
  while (voters.length < Math.min(votersCount, accounts.length - 1)) {
    const idx = Math.floor(rng(accounts.length));
    if (indices.has(idx)) continue;
    indices.add(idx);
    voters.push(accounts[idx]);
  }

  return { admin, voters, all: accounts };
}
