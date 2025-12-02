// src/pages/VotePage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ethers } from "ethers";

// Prefer remote RPC (Sepolia) if set, otherwise local Hardhat, otherwise default localhost
const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";

const ABI = [
  "function candidates() view returns (string[] memory)",
  "function status() view returns (string memory)",
  "function vote(uint256 optionIndex, bytes32 receipt)",
];

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
  const [pk, setPk] = useState(
    () => localStorage.getItem("vote.pk") || ""
  );

  const [voteMsg, setVoteMsg] = useState("");

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

  // contract
  useEffect(() => {
    if (!provider || !ethers.isAddress(addr)) return;
    setContract(new ethers.Contract(addr, ABI, provider));
  }, [provider, addr]);

  async function load() {
    if (!contract) return;
    const st = await contract.status();
    const cs = await contract.candidates();
    setStatus(st);
    setCandidates(cs);
  }

  useEffect(() => {
    if (!contract) return;
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [contract]);

  const canVote = useMemo(() => status === "OPEN", [status]);

  async function getSigner() {
    if (useLocal) {
      if (!pk || !pk.startsWith("0x")) {
        throw new Error("Enter a private key (0x…) for local mode.");
      }
      if (!provider) throw new Error("Provider not ready.");
      return new ethers.Wallet(pk, provider);
    } else {
      if (!window.ethereum) throw new Error("MetaMask not found");
      const bp = new ethers.BrowserProvider(window.ethereum);
      await bp.send("eth_requestAccounts", []);
      return bp.getSigner();
    }
  }

  async function castVote() {
    try {
      setVoteMsg("Connecting wallet…");
      if (!contract) {
        setVoteMsg("❌ Contract not ready.");
        return;
      }

      const signer = await getSigner();
      const write = contract.connect(await signer);

      // voter address (works for both Wallet and MetaMask signer)
      const voterAddr = await (await signer).getAddress();

      // make a receipt (keccak(address, index, random))
      const nonce = ethers.hexlify(ethers.randomBytes(16));
      const enc = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes"],
        [voterAddr, Number(optionIndex), nonce]
      );
      const receipt = ethers.keccak256(enc);

      setVoteMsg("Submitting transaction…");
      const tx = await write.vote(Number(optionIndex), receipt);
      await tx.wait();

      setVoteMsg(`✅ Vote confirmed.\nReceipt:\n${receipt}`);
      await load();
    } catch (e) {
      console.error(e);
      setVoteMsg("❌ " + (e?.reason || e?.shortMessage || e?.message || String(e)));
    }
  }

  return (
    <div className="page">
      <h1>Cast Ballot</h1>

      {/* Auth toggle, same idea as Admin page */}
      <section className="card">
        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={useLocal}
              onChange={(e) => setUseLocal(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Use Local Hardhat signer (unchecked = MetaMask)
          </span>
        </label>

        {useLocal && (
          <>
            <p className="hint">
              ⚠️ Dev-only: pasting a private key in the browser is insecure. Use MetaMask in production.
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

        <button className="btn" onClick={castVote} disabled={!canVote}>
          {canVote ? "Cast Vote" : "Voting Closed"}
        </button>

        <pre
          className="hint"
          style={{ whiteSpace: "pre-wrap", marginTop: 8 }}
        >
          {voteMsg}
        </pre>
      </section>
    </div>
  );
}
