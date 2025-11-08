//VotePage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ethers } from "ethers";

const RPC = import.meta.env.VITE_LOCAL_RPC || import.meta.env.VITE_RPC_URL;

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

  const [pk, setPk] = useState("");          // demo-only local key
  const [voteMsg, setVoteMsg] = useState("");

  // basic guard + provider
  useEffect(() => {
    if (!ethers.isAddress(addr)) { navigate("/", { replace: true }); return; }
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

  async function castVote() {
    try {
      setVoteMsg("Connecting wallet…");
      if (!pk || !pk.startsWith("0x")) {
        setVoteMsg("❌ Enter a private key (demo only).");
        return;
      }
      const wallet = new ethers.Wallet(pk, provider);
      const write = contract.connect(wallet);

      // make a receipt (keccak(address, index, random))
      const nonce = ethers.hexlify(ethers.randomBytes(16));
      const enc = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes"],
        [wallet.address, Number(optionIndex), nonce]
      );
      const receipt = ethers.keccak256(enc);

      setVoteMsg("Submitting transaction…");
      const tx = await write.vote(Number(optionIndex), receipt);
      await tx.wait();

      setVoteMsg(`✅ Vote confirmed.\nReceipt:\n${receipt}`);
      await load();
    } catch (e) {
      console.error(e);
      setVoteMsg("❌ " + (e?.reason || e?.shortMessage || e?.message));
    }
  }

  return (
    <div className="page">
      <h1>Cast Ballot</h1>

      <section className="card">
        <div className="kv"><b>Contract:</b> <span className="mono">{addr}</span></div>
        <div className="kv"><b>Status:</b> {status || "—"}</div>
        <div className="kv"><b>Candidates:</b> {candidates.length ? candidates.join(", ") : "—"}</div>
        <div className="actions">
          <Link className="btn link" to={`/election/${addr}`}>Back to Election</Link>
        </div>
      </section>

      <section className="card">
        <p className="hint">
          ⚠️ Demo only: pasting a private key in the browser is insecure. Use MetaMask in production.
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

        <label className="field">
          <span>Candidate</span>
          <select
            className="input"
            value={optionIndex}
            onChange={(e) => setOptionIndex(Number(e.target.value))}
          >
            {candidates.map((c, i) => (
              <option key={i} value={i}>{i} — {c}</option>
            ))}
          </select>
        </label>

        <button className="btn" onClick={castVote} disabled={!canVote}>
          {canVote ? "Cast Vote" : "Voting Closed"}
        </button>

        <pre className="hint" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
          {voteMsg}
        </pre>
      </section>
    </div>
  );
}
