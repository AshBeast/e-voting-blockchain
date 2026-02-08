// src/pages/VotePage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ethers } from "ethers";

import votingArtifact from "../Voting.json";
import forwarderArtifact from "../Forwarder.json";

// Prefer remote RPC (Sepolia) if set, otherwise local Hardhat, otherwise default localhost
const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:8787";

// EIP-712 types expected by OpenZeppelin ERC2771Forwarder
const FORWARD_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

export default function VotePage() {
  const { addr } = useParams();
  const navigate = useNavigate();

  const [provider, setProvider] = useState(null);
  const [contract, setContract] = useState(null);

  const [status, setStatus] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [optionIndex, setOptionIndex] = useState(0);

  // auth mode
  const [useLocal, setUseLocal] = useState(
    () => localStorage.getItem("vote.useLocal") === "1"
  );
  const [pk, setPk] = useState(() => localStorage.getItem("vote.pk") || "");
  const [voteMsg, setVoteMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem("vote.useLocal", useLocal ? "1" : "0");
  }, [useLocal]);

  useEffect(() => {
    if (pk?.startsWith("0x")) localStorage.setItem("vote.pk", pk);
  }, [pk]);

  // basic guard + provider
  useEffect(() => {
    if (!ethers.isAddress(addr)) {
      navigate("/", { replace: true });
      return;
    }
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, [addr, navigate]);

  // contract (read)
  useEffect(() => {
    if (!provider || !ethers.isAddress(addr)) return;
    setContract(new ethers.Contract(addr, votingArtifact.abi, provider));
  }, [provider, addr]);

  async function load() {
    if (!contract) return;
    try {
      const st = await contract.status();
      const cs = await contract.candidates();
      setStatus(st);
      setCandidates(cs);
    } catch (e) {
      // keep UI alive even if RPC hiccups
      console.error(e);
    }
  }

  useEffect(() => {
    if (!contract) return;
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);

  const canVote = useMemo(() => status === "OPEN", [status]);

  async function getLocalWallet() {
    if (!pk || !pk.startsWith("0x")) {
      throw new Error("Enter a private key (0x…) for local mode.");
    }
    if (!provider) throw new Error("Provider not ready.");
    return new ethers.Wallet(pk, provider);
  }

  async function getMetaMaskSigner() {
    if (!window.ethereum) throw new Error("MetaMask not found");
    const bp = new ethers.BrowserProvider(window.ethereum);
    await bp.send("eth_requestAccounts", []);
    const signer = await bp.getSigner();
    return { bp, signer };
  }

  function makeReceipt(voterAddr, idx) {
    // receipt = keccak256(abi.encodePacked(voter, optionIndex, nonce))
    const nonce16 = ethers.randomBytes(16);
    return ethers.solidityPackedKeccak256(
      ["address", "uint256", "bytes16"],
      [voterAddr, BigInt(idx), nonce16]
    );
  }

  async function castVoteLocal() {
    if (!contract) throw new Error("Contract not ready.");
    const wallet = await getLocalWallet();
    const write = contract.connect(wallet);

    const voterAddr = await wallet.getAddress();
    const receipt = makeReceipt(voterAddr, optionIndex);

    setVoteMsg("Submitting transaction (local)…");
    const tx = await write.vote(Number(optionIndex), receipt);
    await tx.wait();

    setVoteMsg(`✅ Vote confirmed (local).\nReceipt:\n${receipt}`);
    await load();
  }

  async function castVoteGasless() {
    // MetaMask signer + browser provider for chainId
    const { bp, signer } = await getMetaMaskSigner();
    const from = await signer.getAddress();

    // Read Voting using MetaMask provider (prevents chain mismatch)
    const votingOnMM = new ethers.Contract(addr, votingArtifact.abi, bp);

    const receipt = makeReceipt(from, optionIndex);

    // Read forwarder from the Voting contract
    const forwarderAddr = await votingOnMM.trustedForwarder();
    if (
      !ethers.isAddress(forwarderAddr) ||
      forwarderAddr === ethers.ZeroAddress
    ) {
      throw new Error("trustedForwarder() is not set on this contract.");
    }

    const forwarder = new ethers.Contract(
      forwarderAddr,
      forwarderArtifact.abi,
      bp // read-only (relayer executes)
    );

    const net = await bp.getNetwork();
    const chainId = Number(net.chainId);

    // Encode Voting.vote(optionIndex, receipt)
    const iface = new ethers.Interface(votingArtifact.abi);
    const data = iface.encodeFunctionData("vote", [
      Number(optionIndex),
      receipt,
    ]);

    // Nonce for the forwarder (per-signer)
    const nonce = await forwarder.nonces(from);

    // deadline (10 min) — use BigInt for typed-data correctness
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);

    // Gas: estimation can be flaky for ERC2771 (msg.data differs in real execute),
    // so just use a safe default.
    const gas = 500_000n;

    // This object is used ONLY for signing (BigInt is fine here)
    const requestForSig = {
      from,
      to: addr,
      value: 0n,
      gas,
      nonce,
      deadline,
      data,
    };

    // Domain must match Forwarder.sol name:
    // constructor() ERC2771Forwarder("E-VotingForwarder") {}
    const domain = {
      name: "E-VotingForwarder",
      version: "1",
      chainId,
      verifyingContract: forwarderAddr,
    };

    setVoteMsg("Requesting MetaMask signature (gasless)…");
    const signature = await signer.signTypedData(
      domain,
      FORWARD_TYPES,
      requestForSig
    );

    // IMPORTANT: JSON cannot serialize BigInt — send as strings
    const requestForJson = {
      from: requestForSig.from,
      to: requestForSig.to,
      value: requestForSig.value.toString(),
      gas: requestForSig.gas.toString(),
      nonce: requestForSig.nonce.toString(),
      deadline: requestForSig.deadline.toString(),
      data: requestForSig.data,
    };

    setVoteMsg("Sending to relayer (admin pays gas)…");
    const r = await fetch(`${RELAYER_URL}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        forwarder: forwarderAddr,
        request: requestForJson,
        signature,
      }),
    });

    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out?.error || "Relayer error");

    setVoteMsg(
      `✅ Vote relayed!\nTx:\n${out.txHash}\n\nReceipt:\n${receipt}\n\nForwarder:\n${forwarderAddr}`
    );

    await load();
  }

  async function castVote() {
    if (!canVote || busy) return;
    setBusy(true);
    try {
      setVoteMsg("Connecting wallet…");
      if (useLocal) {
        await castVoteLocal();
      } else {
        await castVoteGasless();
      }
    } catch (e) {
      console.error(e);
      setVoteMsg(
        "❌ " + (e?.reason || e?.shortMessage || e?.message || String(e))
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Cast Ballot</h1>

      {/* Auth toggle */}
      <section className="card">
        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={useLocal}
              onChange={(e) => setUseLocal(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Use Local Hardhat signer (unchecked = MetaMask gasless)
          </span>
        </label>

        {useLocal && (
          <>
            <p className="hint">
              ⚠️ Dev-only: pasting a private key in the browser is insecure. Use
              MetaMask in production.
            </p>
            <label className="field">
              <span>Private Key</span>
              <input
                type="password"
                className="input"
                placeholder="0x…"
                value={pk}
                onChange={(e) => setPk(e.target.value)}
              />
            </label>
          </>
        )}
      </section>

      <section className="card">
        <div className="kv">
          <b>Contract:</b> <span className="mono">{addr}</span>
        </div>
        <div className="kv">
          <b>Status:</b> {status || "—"}
        </div>
        <div className="kv">
          <b>Candidates:</b>{" "}
          {candidates.length ? candidates.join(", ") : "—"}
        </div>
        <div className="actions">
          <Link className="btn link" to={`/election/${addr}`}>
            Back to Election
          </Link>
        </div>
      </section>

      <section className="card">
        <label className="field">
          <span>Candidate</span>
          <select
            className="input"
            value={optionIndex}
            onChange={(e) => setOptionIndex(Number(e.target.value))}
          >
            {candidates.map((c, i) => (
              <option key={i} value={i}>
                {i} — {c}
              </option>
            ))}
          </select>
        </label>

        <button className="btn" onClick={castVote} disabled={!canVote || busy}>
          {busy ? "Working…" : canVote ? "Cast Vote" : "Voting Closed"}
        </button>

        <pre className="hint" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
          {voteMsg}
        </pre>
      </section>
    </div>
  );
}
