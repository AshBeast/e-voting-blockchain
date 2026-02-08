// AdminPanel.jsx
import { useState } from "react";
import { ethers, NonceManager } from "ethers";
import votingArtifact from "./Voting.json";
import forwarderArtifact from "./Forwarder.json";

const LOCAL_RPC = import.meta.env.VITE_LOCAL_RPC || "http://127.0.0.1:8545";

export default function AdminPanel() {
  const [title, setTitle] = useState("");
  const [cands, setCands] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [voterBlob, setVoterBlob] = useState("");

  const [deployedAddr, setDeployedAddr] = useState("");
  const [forwarderAddr, setForwarderAddr] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  // Mode: local Hardhat (admin PK) or MetaMask
  const [useLocal, setUseLocal] = useState(false);
  const [adminPk, setAdminPk] = useState(""); // only used in local mode

  const toUnix = (s) => {
    const t = new Date(s).getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.floor(t / 1000);
  };

  function parseAddresses(input) {
    const re = /0x[a-fA-F0-9]{40}\b/g;
    const raw = input.match(re) || [];
    const out = [];
    const seen = new Set();
    for (const a of raw) {
      try {
        const ck = ethers.getAddress(a);
        if (!seen.has(ck)) {
          seen.add(ck);
          out.push(ck);
        }
      } catch {
        // ignore invalid substrings
      }
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
      const endTs = toUnix(end);
      const candidates = cands
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const voters = parseAddresses(voterBlob);

      if (!title || candidates.length < 2)
        throw new Error("Need a title and ≥ 2 candidates");
      if (!(startTs > 0 && endTs > startTs))
        throw new Error("Bad time window");
      if (voters.length === 0)
        throw new Error("Provide at least one eligible voter address");

      // 1) Deploy Forwarder
      setStatus("Deploying Forwarder…");
      const forwarderFactory = new ethers.ContractFactory(
        forwarderArtifact.abi,
        forwarderArtifact.bytecode,
        signer
      );

      const forwarder = await forwarderFactory.deploy();
      setStatus("Waiting for Forwarder confirmation…");
      await forwarder.deploymentTransaction().wait();
      const fwdAddr = await forwarder.getAddress();
      setForwarderAddr(fwdAddr);

      // 2) Deploy Voting (NOW requires 5 args)
      setStatus(`Deploying election… (Forwarder: ${fwdAddr})`);
      const votingFactory = new ethers.ContractFactory(
        votingArtifact.abi,
        votingArtifact.bytecode,
        signer
      );

      // ✅ NEW constructor signature:
      // (title, candidates, startTs, endTs, trustedForwarder)
      const contract = await votingFactory.deploy(
        title,
        candidates,
        startTs,
        endTs,
        fwdAddr
      );

      setStatus("Waiting for election deployment confirmation…");
      const rcpt = await contract.deploymentTransaction().wait();
      const addr = rcpt.contractAddress ?? (await contract.getAddress());
      setDeployedAddr(addr);

      // 3) Register voters using SAME signer
      const bound = new ethers.Contract(addr, votingArtifact.abi, signer);
      setStatus(`Registering ${voters.length} voters…`);
      const regTx = await bound.registerVoters(voters);
      await regTx.wait();

      setStatus(`✅ Deployed & registered. Contract: ${addr}`);
    } catch (e) {
      console.error(e);
      setStatus(
        "❌ " + (e?.reason || e?.shortMessage || e?.message || String(e))
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
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
          <label>
            Admin Private Key (dev only)
            <br />
            <input
              type="password"
              value={adminPk}
              onChange={(e) => setAdminPk(e.target.value)}
              placeholder="0x… (Hardhat Account #0)"
              style={{ width: "100%" }}
            />
          </label>
          <p style={{ color: "#a00", fontSize: "0.85em" }}>
            ⚠️ Dev-only. Never paste a real key here.
          </p>
        </div>
      )}

      <label>
        Title
        <br />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: "100%" }}
        />
      </label>

      <br />
      <br />
      <label>
        Candidates (comma-separated)
        <br />
        <input
          value={cands}
          onChange={(e) => setCands(e.target.value)}
          style={{ width: "100%" }}
          placeholder="Alice, Bob, Charlie"
        />
      </label>

      <br />
      <br />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <label>
          Start (local)
          <br />
          <input
            type="datetime-local"
            step="1"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          End (local)
          <br />
          <input
            type="datetime-local"
            step="1"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>

      <br />
      <label>
        Eligible Voter Addresses (paste; only addresses are used)
        <br />
        <textarea
          value={voterBlob}
          onChange={(e) => setVoterBlob(e.target.value)}
          rows={8}
          style={{ width: "100%", fontFamily: "monospace" }}
          placeholder={`Paste lines like:
Account #0: 0xf39F... (10000 ETH)
Account #1: 0x7099...
... etc ...
`}
        />
      </label>

      <br />
      <button onClick={deployAndRegister} disabled={busy}>
        {busy ? "Working…" : "Deploy & Register"}
      </button>

      <p style={{ marginTop: "1rem" }}>{status}</p>

      {forwarderAddr && (
        <p>
          <b>Forwarder:</b> {forwarderAddr}
        </p>
      )}

      {deployedAddr && (
        <p>
          <b>Contract:</b> {deployedAddr}
        </p>
      )}
    </div>
  );
}
