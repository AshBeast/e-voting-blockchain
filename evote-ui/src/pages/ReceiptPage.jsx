// ReceiptPage.jsx
import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ethers } from "ethers";

const RPC = import.meta.env.VITE_LOCAL_RPC || import.meta.env.VITE_RPC_URL;

const ABI = [
  "function hasReceipt(bytes32 receipt) view returns (bool)",
];

export default function ReceiptPage() {
  const { addr } = useParams();
  const navigate = useNavigate();

  const [provider, setProvider] = useState(null);
  const [contract, setContract] = useState(null);

  const [receiptInput, setReceiptInput] = useState("");
  const [checkMsg, setCheckMsg] = useState("");

  // guard + provider
  useEffect(() => {
    if (!ethers.isAddress(addr)) { navigate("/", { replace: true }); return; }
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, [addr, navigate]);

  // contract
  useEffect(() => {
    if (!provider || !ethers.isAddress(addr)) return;
    setContract(new ethers.Contract(addr, ABI, provider));
  }, [provider, addr]);

  async function checkReceipt() {
    try {
      setCheckMsg("Checking…");
      const r = receiptInput.trim();
      if (!r || !r.startsWith("0x") || r.length !== 66) {
        setCheckMsg("❌ Enter a 32-byte hex (0x…64 hex chars).");
        return;
      }
      const used = await contract.hasReceipt(r);
      setCheckMsg(used ? "✅ Found on-chain (vote included)." : "❌ Not found.");
    } catch (e) {
      console.error(e);
      setCheckMsg("❌ " + (e?.reason || e?.message));
    }
  }

  return (
    <div className="page">
      <h1>Verify Receipt</h1>

      <section className="card">
        <div className="kv"><b>Contract:</b> <span className="mono">{addr}</span></div>
        <div className="actions">
          <Link className="btn link" to={`/election/${addr}`}>Back to Election</Link>
        </div>
      </section>

      <section className="card">
        <label className="field">
          <span>Receipt (0x + 32-byte hex)</span>
          <input
            className="input"
            type="text"
            placeholder="0x…"
            value={receiptInput}
            onChange={(e) => setReceiptInput(e.target.value)}
          />
        </label>
        <button className="btn" onClick={checkReceipt}>Check</button>
        <div className="hint" style={{ marginTop: 8 }}>{checkMsg}</div>
      </section>
    </div>
  );
}
