import { ethers } from "ethers";

const KNOWN_ELECTIONS_KEY = "known_elections";

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function normalizeAddress(addr) {
  try {
    return ethers.getAddress(addr);
  } catch {
    return null;
  }
}

export function getKnownElectionAddresses() {
  const saved = safeParse(localStorage.getItem(KNOWN_ELECTIONS_KEY) || "[]", []);
  const list = Array.isArray(saved) ? saved : [];
  const extra = [
    localStorage.getItem("last_contract") || "",
    (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim(),
  ];

  const dedup = new Set();
  for (const raw of [...list, ...extra]) {
    const addr = normalizeAddress(raw);
    if (addr) dedup.add(addr);
  }
  return Array.from(dedup);
}

export function addKnownElectionAddress(addr) {
  const normalized = normalizeAddress(addr);
  if (!normalized) return;

  const existing = getKnownElectionAddresses();
  if (existing.some((a) => a.toLowerCase() === normalized.toLowerCase())) return;

  const next = [...existing, normalized];
  localStorage.setItem(KNOWN_ELECTIONS_KEY, JSON.stringify(next));
}

export function clearKnownElectionAddresses() {
  localStorage.removeItem(KNOWN_ELECTIONS_KEY);
}

function votedKey(chainId, electionAddress, voterAddress) {
  return `voted:${String(chainId)}:${electionAddress.toLowerCase()}:${voterAddress.toLowerCase()}`;
}

export function markVotedLocally({
  chainId,
  electionAddress,
  voterAddress,
  receipt,
  txHash,
}) {
  if (!chainId || !electionAddress || !voterAddress) return;
  localStorage.setItem(
    votedKey(chainId, electionAddress, voterAddress),
    JSON.stringify({
      receipt: receipt || "",
      txHash: txHash || "",
      ts: Date.now(),
    })
  );
}

export function getLocalVoteMarker({ chainId, electionAddress, voterAddress }) {
  if (!chainId || !electionAddress || !voterAddress) return null;
  return safeParse(
    localStorage.getItem(votedKey(chainId, electionAddress, voterAddress)),
    null
  );
}
