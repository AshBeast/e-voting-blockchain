// src/App.jsx
import { useState } from "react";
import { ethers } from "ethers";
import { useNavigate } from "react-router-dom";

export default function App() {
  const navigate = useNavigate();
  const [addr, setAddr] = useState(localStorage.getItem("last_contract") || "");
  const [err, setErr] = useState("");

  function go() {
    if (!ethers.isAddress(addr)) {
      setErr("Enter a valid Ethereum address (0x + 40 hex).");
      return;
    }
    localStorage.setItem("last_contract", addr);
    navigate(`/election/${addr}`);
  }

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>🗳️ Voting Demo</h1>
      <p>Enter a deployed Voting.sol contract address to view the election.</p>
      <input
        value={addr}
        onChange={(e) => setAddr(e.target.value.trim())}
        placeholder="0x…"
        style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={go} style={btn}>Open Election</button>
        <button
          onClick={() => {
            const last = localStorage.getItem("last_contract");
            if (last) { setAddr(last); setErr(""); }
          }}
          style={btn}
        >
          Use Last
        </button>
      </div>
      {err && <div style={{ marginTop: 10, color: "#b91c1c" }}>❌ {err}</div>}
    </div>
  );
}

const btn = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#f9fafb",
  cursor: "pointer",
};
