require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const forwarderArtifact = require("../src/Forwarder.json");

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

app.get("/health", async (_req, res) => {
  const net = await provider.getNetwork();
  res.json({
    ok: true,
    relayer: relayer.address,
    chainId: Number(net.chainId),
  });
});

app.post("/relay", async (req, res) => {
  try {
    const { forwarder, request, signature } = req.body || {};
    if (!ethers.isAddress(forwarder)) throw new Error("Bad forwarder address");
    if (!request || typeof request !== "object")
      throw new Error("Missing request");
    if (!signature || typeof signature !== "string")
      throw new Error("Missing signature");

    const normalized = {
      ...request,
      value: request.value ?? "0",
      gas: request.gas,
      deadline: request.deadline,
    };

    // Forwarder expects a struct that INCLUDES signature (OpenZeppelin pattern)
    const reqWithSig = { ...request, signature };

    const fwd = new ethers.Contract(forwarder, forwarderArtifact.abi, relayer);

    // verify(request) then execute(request) — OpenZeppelin ERC2771Forwarder flow
    const ok = await fwd.verify(reqWithSig);
    if (!ok)
      throw new Error(
        "Forwarder.verify() failed (bad signature / bad nonce / expired)",
      );

    // Estimate gas for execute
    const est = await fwd.execute.estimateGas(reqWithSig);
    const gasLimit = est + est / 5n; // +20%

    const tx = await fwd.execute(reqWithSig, { gasLimit });
    const rcpt = await tx.wait();

    res.json({ txHash: tx.hash, status: rcpt.status });
  } catch (e) {
    res.status(400).json({
      error: e?.reason || e?.shortMessage || e?.message || String(e),
    });
  }
});

app.listen(RELAYER_PORT, () => {
  console.log(`Relayer listening on http://localhost:${RELAYER_PORT}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Relayer address: ${relayer.address}`);
});
