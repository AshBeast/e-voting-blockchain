import { useState } from "react";
import { ethers, NonceManager } from "ethers";
import votingArtifact from "./Voting.json";

const LOCAL_RPC = import.meta.env.VITE_LOCAL_RPC || "http://127.0.0.1:8545";

export default function AdminPanel() {
  const [title, setTitle] = useState("");
  const [cands, setCands] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [voterBlob, setVoterBlob] = useState("");

  const [deployedAddr, setDeployedAddr] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  // Mode: local Hardhat (admin PK) or MetaMask
  const [useLocal, setUseLocal] = useState(false);
  const [adminPk, setAdminPk] = useState(""); // only used in local mode

  const toUnix = (s) => Math.floor(new Date(s).getTime() / 1000);

  function parseAddresses(input) {
    const re = /0x[a-fA-F0-9]{40}\b/g;
    const raw = input.match(re) || [];
    const out = [];
    const seen = new Set();
    for (const a of raw) {
      try {
        const ck = ethers.getAddress(a);
        if (!seen.has(ck)) { seen.add(ck); out.push(ck); }
      } catch { /* empty */ }
    }
    return out;
  }

  async function getSigner() {
    if (useLocal) {
      if (!adminPk || !adminPk.startsWith("0x")) {
        throw new Error("Enter the admin private key (0x…) for local mode.");
      }
      const provider = new ethers.JsonRpcProvider(LOCAL_RPC);
      const base = new ethers.Wallet(adminPk, provider);
      return new NonceManager(base);
    } else {
      if (!window.ethereum) throw new Error("MetaMask not found");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const base = await provider.getSigner();
      return new NonceManager(base);
    }
  }

  async function deployAndRegister() {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(useLocal ? "Connecting Hardhat…" : "Connecting MetaMask…");
      const signer = await getSigner();

      const startTs = toUnix(start);
      const endTs   = toUnix(end);
      const candidates = cands.split(",").map(s => s.trim()).filter(Boolean);
      const voters = parseAddresses(voterBlob);

      if (!title || candidates.length < 2) throw new Error("Need a title and ≥ 2 candidates");
      if (!(startTs > 0 && endTs > startTs)) throw new Error("Bad time window");
      if (voters.length === 0) throw new Error("Provide at least one eligible voter address");

      setStatus("Deploying election…");
      const factory = new ethers.ContractFactory(
        votingArtifact.abi,
        votingArtifact.bytecode,
        signer
      );

      // existing constructor signature: (title, candidates, startTs, endTs)
      const contract = await factory.deploy(title, candidates, startTs, endTs);
      setStatus("Waiting for deployment confirmation…");
      const rcpt = await contract.deploymentTransaction().wait();
      const addr = rcpt.contractAddress ?? await contract.getAddress();
      setDeployedAddr(addr);

      // Register voters immediately, using the SAME signer (keeps nonces in order)
      const bound = new ethers.Contract(addr, votingArtifact.abi, signer);
      setStatus(`Registering ${voters.length} voters…`);
      const regTx = await bound.registerVoters(voters);
      await regTx.wait();

      setStatus(`✅ Deployed & registered. Contract: ${addr}`);
    } catch (e) {
      console.error(e);
      setStatus("❌ " + (e.reason || e.shortMessage || e.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui"}}>
      <h2>Admin: Create Election</h2>

      <label style={{ display: "block", marginBottom: "1rem" }}>
        <input
          type="checkbox"
          checked={useLocal}
          onChange={(e) => setUseLocal(e.target.checked)}
        />{" "}
        Use Local Hardhat (unchecked = MetaMask)
      </label>

      {useLocal && (
        <div style={{ marginBottom: "1rem" }}>
          <label>Admin Private Key (dev only)<br/>
            <input
              type="password"
              value={adminPk}
              onChange={(e)=>setAdminPk(e.target.value)}
              placeholder="0x… (Hardhat Account #0)"
              style={{width:"100%"}}
            />
          </label>
          <p style={{ color: "#a00", fontSize: "0.85em" }}>
            ⚠️ Dev-only. Never paste a real key here.
          </p>
        </div>
      )}

      <label>Title<br/>
        <input value={title} onChange={e=>setTitle(e.target.value)} style={{width:"100%"}} />
      </label>

      <br/><br/>
      <label>Candidates (comma-separated)<br/>
        <input
          value={cands}
          onChange={e=>setCands(e.target.value)}
          style={{width:"100%"}}
          placeholder="Alice, Bob, Charlie"
        />
      </label>

      <br/><br/>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem"}}>
        <label>Start (local)<br/>
          <input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} />
        </label>
        <label>End (local)<br/>
          <input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} />
        </label>
      </div>

      <br/>
      <label>Eligible Voter Addresses (paste; only addresses are used)<br/>
        <textarea
          value={voterBlob}
          onChange={(e)=>setVoterBlob(e.target.value)}
          rows={8}
          style={{width:"100%", fontFamily:"monospace"}}
          placeholder={`Paste lines like:
Account #0: 0xf39F... (10000 ETH)
Account #1: 0x7099...
... etc ...
`}
        />
      </label>

      <br/>
      <button onClick={deployAndRegister} disabled={busy}>
        {busy ? "Working…" : "Deploy & Register"}
      </button>

      <p style={{marginTop:"1rem"}}>{status}</p>
      {deployedAddr && <p><b>Contract:</b> {deployedAddr}</p>}
    </div>
  );
}
