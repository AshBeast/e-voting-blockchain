require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const votingArtifact = require("../src/Voting.json");
const semaphoreArtifact = require("../src/Semaphore.json");

const RELAYER_PORT = process.env.RELAYER_PORT || 8787;
const RPC_URL = process.env.RELAYER_RPC_URL || "http://127.0.0.1:8545";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;

if (!RELAYER_PRIVATE_KEY || !RELAYER_PRIVATE_KEY.startsWith("0x")) {
  throw new Error("Missing RELAYER_PRIVATE_KEY in .env (must start with 0x)");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayer = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const semaphoreIface = new ethers.Interface(semaphoreArtifact.abi);

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
