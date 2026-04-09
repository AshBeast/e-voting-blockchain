const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const customEnvFile = process.env.RELAYER_ENV_FILE
  ? path.resolve(process.cwd(), process.env.RELAYER_ENV_FILE)
  : "";

const envSources = customEnvFile
  ? [
      // When a relayer env file is explicitly selected, treat it as the
      // authoritative runtime config instead of mixing in local-dev relayer files.
      { path: path.join(process.cwd(), ".env"), override: false },
      { path: customEnvFile, override: true },
    ]
  : [
      { path: path.join(process.cwd(), ".env"), override: false },
      { path: path.join(process.cwd(), ".env.local"), override: false },
      // Prefer relayer-specific env files over the UI root env files.
      { path: path.join(__dirname, ".env"), override: true },
      { path: path.join(__dirname, ".env.local"), override: true },
    ];

for (const source of envSources) {
  if (source.path && fs.existsSync(source.path)) {
    dotenv.config({ path: source.path, override: source.override });
  }
}

const votingArtifact = require("../src/Voting.json");
const semaphoreArtifact = require("../src/Semaphore.json");

const RELAYER_PORT = process.env.RELAYER_PORT || 8787;
const RPC_URL =
  process.env.RELAYER_RPC_URL ||
  process.env.VITE_RPC_URL ||
  "http://127.0.0.1:8545";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const REGISTRY_FILE =
  process.env.RELAYER_ELECTIONS_FILE ||
  path.join(__dirname, "data", "elections.json");
const REGISTRY_MAX_ELECTIONS = 50;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 10;

if (!RELAYER_PRIVATE_KEY || !RELAYER_PRIVATE_KEY.startsWith("0x")) {
  throw new Error(
    customEnvFile
      ? `Missing RELAYER_PRIVATE_KEY in ${path.basename(customEnvFile)} (must start with 0x)`
      : "Missing RELAYER_PRIVATE_KEY in .env (must start with 0x)"
  );
}

if (RELAYER_PRIVATE_KEY.includes("PUT_A_REAL")) {
  throw new Error(
    "RELAYER_PRIVATE_KEY is still using the placeholder value. Replace it with a real funded key in evote-ui/relayer/.env.local or evote-ui/.env.local."
  );
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayer = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const semaphoreIface = new ethers.Interface(semaphoreArtifact.abi);

function ensureRegistryDir() {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
}

function normalizeAddr(addr) {
  return ethers.getAddress(addr);
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function trimRegistryInPlace(registry) {
  if (!registry || !Array.isArray(registry.elections)) return false;
  if (registry.elections.length <= REGISTRY_MAX_ELECTIONS) return false;

  registry.elections.sort((a, b) => Number(a.addedAt || 0) - Number(b.addedAt || 0));
  registry.elections = registry.elections.slice(
    registry.elections.length - REGISTRY_MAX_ELECTIONS
  );
  return true;
}

function loadRegistry() {
  ensureRegistryDir();
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, elections: [] };
    }
    const elections = Array.isArray(parsed.elections) ? parsed.elections : [];
    const registry = { version: 1, elections };
    if (trimRegistryInPlace(registry)) {
      saveRegistry(registry);
    }
    return registry;
  } catch {
    return { version: 1, elections: [] };
  }
}

function saveRegistry(registry) {
  ensureRegistryDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

async function upsertElection({
  address,
  chainId,
  title = "",
  startTs = null,
  endTs = null,
  source = "",
}) {
  const normalized = normalizeAddr(address);
  const net = await provider.getNetwork();
  const cid = Number(chainId || net.chainId);
  const now = Date.now();

  const registry = loadRegistry();
  const key = `${cid}:${normalized.toLowerCase()}`;
  let existing = null;

  for (const item of registry.elections) {
    const itemKey = `${Number(item.chainId)}:${String(item.address).toLowerCase()}`;
    if (itemKey === key) {
      existing = item;
      break;
    }
  }

  if (existing) {
    existing.lastSeenAt = now;
    if (title && !existing.title) existing.title = String(title);
    if (startTs != null && existing.startTs == null) existing.startTs = Number(startTs);
    if (endTs != null && existing.endTs == null) existing.endTs = Number(endTs);
    if (source) existing.source = source;
  } else {
    registry.elections.push({
      chainId: cid,
      address: normalized,
      title: title ? String(title) : "",
      startTs: startTs == null ? null : Number(startTs),
      endTs: endTs == null ? null : Number(endTs),
      source: source || "",
      addedAt: now,
      lastSeenAt: now,
    });
  }

  trimRegistryInPlace(registry);
  saveRegistry(registry);
  return { chainId: cid, address: normalized };
}

async function readElectionMeta(address) {
  const c = new ethers.Contract(
    address,
    ["function electionInfo() view returns (string,uint64,uint64)"],
    provider
  );
  const info = await c.electionInfo();
  return {
    title: String(info[0] || ""),
    startTs: Number(info[1]),
    endTs: Number(info[2]),
  };
}

function asBigInt(value, label) {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Bad ${label}`);
  }
}

function normalizeProof(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Missing proof");
  if (!Array.isArray(raw.points) || raw.points.length !== 8) {
    throw new Error("Bad proof.points");
  }

  return {
    merkleTreeDepth: asBigInt(raw.merkleTreeDepth, "proof.merkleTreeDepth"),
    merkleTreeRoot: asBigInt(raw.merkleTreeRoot, "proof.merkleTreeRoot"),
    nullifier: asBigInt(raw.nullifier, "proof.nullifier"),
    message: asBigInt(raw.message, "proof.message"),
    scope: asBigInt(raw.scope, "proof.scope"),
    points: raw.points.map((p, i) => asBigInt(p, `proof.points[${i}]`)),
  };
}

function firstHexString(value) {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) {
    return value;
  }
  return null;
}

function extractRevertData(err) {
  const seen = new Set();
  const queue = [err];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);

    for (const key of ["data", "error", "info", "cause", "result"]) {
      const val = cur[key];
      const hex = firstHexString(val);
      if (hex) return hex;
      if (val && typeof val === "object") queue.push(val);
    }

    if (typeof cur.body === "string") {
      try {
        queue.push(JSON.parse(cur.body));
      } catch {
        // ignore non-JSON body
      }
    }
  }

  return null;
}

function friendlyError(err) {
  const fallback = err?.reason || err?.shortMessage || err?.message || String(err);
  const revertData = extractRevertData(err);

  if (revertData) {
    try {
      const parsed = semaphoreIface.parseError(revertData);
      if (parsed?.name === "Semaphore__YouAreUsingTheSameNullifierTwice") {
        return "can't vote twice";
      }
      if (parsed?.name === "Semaphore__InvalidProof") {
        return "invalid zero-knowledge proof";
      }
    } catch {
      // not a Semaphore custom error; fall back below
    }
  }

  const text = String(fallback || "").toLowerCase();
  if (text.includes("youareusingthesamenullifiertwice") || text.includes("nullifier")) {
    return "can't vote twice";
  }
  if (text.includes("linking closed")) {
    return "identity linking is closed after election start";
  }
  if (text.includes("not registered")) {
    return "wallet is not registered for this election";
  }

  return fallback;
}

app.get("/health", async (_req, res) => {
  const net = await provider.getNetwork();
  res.json({
    ok: true,
    relayer: relayer.address,
    chainId: Number(net.chainId),
    mode: "zk",
  });
});

app.get("/elections", async (req, res) => {
  try {
    const requestedChainId = req.query?.chainId;
    const requestedPage = req.query?.page;
    const requestedPageSize = req.query?.pageSize;
    const net = await provider.getNetwork();
    const currentChainId = Number(net.chainId);
    const chainIdFilter =
      requestedChainId == null || requestedChainId === ""
        ? currentChainId
        : Number(requestedChainId);

    if (!Number.isFinite(chainIdFilter) || chainIdFilter < 0) {
      throw new Error("Bad chainId query");
    }

    const page = parsePositiveInt(requestedPage, 1);
    const pageSize = Math.min(
      parsePositiveInt(requestedPageSize, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    );

    const registry = loadRegistry();
    const filtered = registry.elections
      .filter((e) => Number(e.chainId) === chainIdFilter)
      .sort((a, b) => Number(b.addedAt || 0) - Number(a.addedAt || 0));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const elections = filtered.slice(start, start + pageSize);

    res.json({
      ok: true,
      chainId: chainIdFilter,
      total,
      page: safePage,
      pageSize,
      totalPages,
      count: elections.length,
      elections,
    });
  } catch (e) {
    res.status(400).json({
      error: e?.message || String(e),
    });
  }
});

app.post("/elections/register", async (req, res) => {
  try {
    const { address, chainId, title, startTs, endTs, source } = req.body || {};
    if (!ethers.isAddress(address)) throw new Error("Bad address");
    const meta = await readElectionMeta(address);

    const saved = await upsertElection({
      address,
      chainId,
      title: title || meta.title,
      startTs: startTs ?? meta.startTs,
      endTs: endTs ?? meta.endTs,
      source: source || "manual",
    });

    res.json({
      ok: true,
      chainId: saved.chainId,
      address: saved.address,
    });
  } catch (e) {
    res.status(400).json({
      error: e?.message || String(e),
    });
  }
});

app.post("/zk-link", async (req, res) => {
  try {
    const { votingAddress, voter, identityCommitment, expiry, signature } =
      req.body || {};

    if (!ethers.isAddress(votingAddress)) throw new Error("Bad votingAddress");
    if (!ethers.isAddress(voter)) throw new Error("Bad voter address");
    if (typeof signature !== "string" || !signature.startsWith("0x")) {
      throw new Error("Bad signature");
    }

    const commitment = asBigInt(identityCommitment, "identityCommitment");
    const exp = asBigInt(expiry, "expiry");

    const voting = new ethers.Contract(votingAddress, votingArtifact.abi, relayer);
    const tx = await voting.linkIdentity(voter, commitment, exp, signature);
    const rcpt = await tx.wait();
    let meta = {};
    try {
      meta = await readElectionMeta(votingAddress);
    } catch {
      // ignore metadata fetch issues
    }
    await upsertElection({
      address: votingAddress,
      ...meta,
      source: "zk-link",
    });

    res.json({ txHash: tx.hash, status: rcpt.status });
  } catch (e) {
    res.status(400).json({
      error: friendlyError(e),
    });
  }
});

async function handleZkVote(req, res) {
  try {
    const { votingAddress, optionIndex, receipt, proof } = req.body || {};

    if (!ethers.isAddress(votingAddress)) throw new Error("Bad votingAddress");
    if (!Number.isInteger(Number(optionIndex)) || Number(optionIndex) < 0) {
      throw new Error("Bad optionIndex");
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(receipt || "")) {
      throw new Error("Bad receipt");
    }

    const normalizedProof = normalizeProof(proof);

    const voting = new ethers.Contract(votingAddress, votingArtifact.abi, relayer);
    // Simulate first so user gets readable errors before paying gas.
    await voting.vote.staticCall(Number(optionIndex), normalizedProof, receipt);

    const tx = await voting.vote(Number(optionIndex), normalizedProof, receipt);
    const rcpt = await tx.wait();
    let meta = {};
    try {
      meta = await readElectionMeta(votingAddress);
    } catch {
      // ignore metadata fetch issues
    }
    await upsertElection({
      address: votingAddress,
      ...meta,
      source: "zk-vote",
    });

    res.json({ txHash: tx.hash, status: rcpt.status, receipt });
  } catch (e) {
    res.status(400).json({
      error: friendlyError(e),
    });
  }
}

app.post("/zk-vote", handleZkVote);

// Backward-compat alias.
app.post("/private-vote", async (req, res) => {
  await handleZkVote(req, res);
});

app.listen(RELAYER_PORT, () => {
  console.log(`Relayer listening on http://localhost:${RELAYER_PORT}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Relayer address: ${relayer.address}`);
});
