// AdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { ethers, NonceManager } from "ethers";
import votingArtifact from "../Voting.json";

const RPC = import.meta.env.VITE_LOCAL_RPC || import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
const DEFAULT_ADDR = (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim();

const MGMT_ABI = [
  "function admin() view returns (address)",
  "function status() view returns (string)",
  "function electionInfo() view returns (string,uint64,uint64)",
  "function endNow()",
  "function setWindow(uint64 startTs, uint64 endTs)",
  "function setEnd(uint64 endTs)",
  "function registerVoters(address[])",
];

/* ------------ helpers ------------ */
const toUnix = (s) => Math.floor(new Date(s).getTime() / 1000);

// ✅ do NOT early-return on a bad token; just skip it
function parseAddresses(input) {
  const re = /0x[a-fA-F0-9]{40}\b/g;
  const raw = input.match(re) || [];
  const out = [];
  const seen = new Set();
  for (const a of raw) {
    try {
      const ck = ethers.getAddress(a);
      if (!seen.has(ck)) { seen.add(ck); out.push(ck); }
    } catch {
      // skip invalid substrings, don't return
    }
  }
  return out;
}

async function hasCode(provider, addr) {
  try {
    const code = await provider.getCode(addr);
    return !!code && code !== "0x";
  } catch {
    return false;
  }
}

export default function AdminPage() {
  const [provider, setProvider] = useState(null);
  useEffect(() => { setProvider(new ethers.JsonRpcProvider(RPC)); }, []);

  /* --------------- tabs --------------- */
  const [tab, setTab] = useState("create"); // "create" | "manage"

  /* --------------- auth mode --------------- */
  // ✅ persist auth prefs so reload keeps your “login”
  const [useLocal, setUseLocal] = useState(() => localStorage.getItem("admin.useLocal") === "1");
  const [adminPk, setAdminPk] = useState(() => localStorage.getItem("admin.pk") || "");

  useEffect(() => { localStorage.setItem("admin.useLocal", useLocal ? "1" : "0"); }, [useLocal]);
  useEffect(() => {
    if (adminPk?.startsWith("0x")) localStorage.setItem("admin.pk", adminPk);
  }, [adminPk]);

  async function getSigner() {
    if (useLocal) {
      if (!adminPk || !adminPk.startsWith("0x")) {
        throw new Error("Enter the admin private key (0x…) for local mode.");
      }
      const base = new ethers.Wallet(adminPk, provider);
      return new NonceManager(base);
    } else {
      if (!window.ethereum) throw new Error("MetaMask not found");
      const bp = new ethers.BrowserProvider(window.ethereum);
      await bp.send("eth_requestAccounts", []);
      const base = await bp.getSigner();
      return new NonceManager(base);
    }
  }

  /* ============= CREATE ELECTION ============= */
  const [title, setTitle] = useState("");
  const [cands, setCands] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [voterBlob, setVoterBlob] = useState("");
  const [createMsg, setCreateMsg] = useState("");
  const [deployedAddr, setDeployedAddr] = useState("");
  const [busyCreate, setBusyCreate] = useState(false); // ✅

  async function deployAndRegister() {
    if (busyCreate) return;                 // ✅ guard against double clicks
    setBusyCreate(true);                    // ✅
    try {
      setCreateMsg(useLocal ? "Connecting Hardhat…" : "Connecting MetaMask…");
      const signer = await getSigner();

      if (!provider) throw new Error("Provider not ready (RPC misconfigured).");

      const startTs = toUnix(start);
      const endTs   = toUnix(end);
      const candidates = cands.split(",").map(s => s.trim()).filter(Boolean);
      const voters = parseAddresses(voterBlob);

      if (!title || candidates.length < 2) throw new Error("Need a title and ≥ 2 candidates");
      if (!(startTs > 0 && endTs > startTs)) throw new Error("Bad time window");
      if (voters.length === 0) throw new Error("Provide at least one eligible voter address");

      setCreateMsg("Deploying election…");
      const factory = new ethers.ContractFactory(
        votingArtifact.abi,
        votingArtifact.bytecode,
        signer
      );

      const contract = await factory.deploy(title, candidates, startTs, endTs);
      setCreateMsg("Waiting for deployment confirmation…");
      const rcpt = await contract.deploymentTransaction().wait();
      const addr = rcpt.contractAddress ?? await contract.getAddress();
      setDeployedAddr(addr);

      // ✅ remember last deployed for quick use
      localStorage.setItem("last_contract", addr);

      const bound = new ethers.Contract(addr, votingArtifact.abi, signer);
      setCreateMsg(`Registering ${voters.length} voters…`);
      const regTx = await bound.registerVoters(voters);
      await regTx.wait();

      setCreateMsg(`✅ Deployed & registered. Contract: ${addr}`);
    } catch (e) {
      console.error(e);
      setCreateMsg("❌ " + (e.reason || e.shortMessage || e.message || String(e)));
    } finally {
      setBusyCreate(false);                 // ✅
    }
  }

  /* ============= MANAGE EXISTING ============= */
  const [attachAddr, setAttachAddr] = useState(() =>
    localStorage.getItem("admin.attach") || DEFAULT_ADDR
  );
  useEffect(() => { if (attachAddr) localStorage.setItem("admin.attach", attachAddr); }, [attachAddr]);

  const [mgmtMsg, setMgmtMsg] = useState("");
  const [mgmt, setMgmt] = useState({
    contract: null,
    admin: "",
    you: "",
    title: "",
    startTs: 0,
    endTs: 0,
    status: "",
  });
  const [busyManage, setBusyManage] = useState(false); // ✅

  const isAdmin = useMemo(() => {
    return mgmt.admin && mgmt.you && mgmt.admin.toLowerCase() === mgmt.you.toLowerCase();
  }, [mgmt.admin, mgmt.you]);

  async function attach() {
    if (busyManage) return;                 // ✅
    setBusyManage(true);                    // ✅
    try {
      setMgmtMsg("Checking address…");
      if (!ethers.isAddress(attachAddr)) throw new Error("Enter a valid contract address.");
      if (!provider) throw new Error("Provider not ready.");

      const ok = await hasCode(provider, attachAddr);
      if (!ok) throw new Error("No contract code at this address on current RPC.");

      const c = new ethers.Contract(attachAddr, MGMT_ABI, provider);

      setMgmtMsg("Loading election info…");
      let admin = "";
      try { admin = await c.admin(); } catch {print}

      const [nm, sTs, eTs] = await c.electionInfo();
      const st = await c.status();

      // who are you?
      let you = "";
      try {
        const signer = await getSigner();
        you = await signer.getAddress();
      } catch {print}

      setMgmt({
        contract: c,
        admin,
        you,
        title: nm,
        startTs: Number(sTs),
        endTs: Number(eTs),
        status: st,
      });
      setMgmtMsg("✅ Attached.");
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.message || String(e)));
      setMgmt({ contract: null, admin: "", you: "", title: "", startTs: 0, endTs: 0, status: "" });
    } finally {
      setBusyManage(false);                 // ✅
    }
  }

  async function endElectionNow() {
    if (busyManage) return;                 // ✅
    setBusyManage(true);                    // ✅
    try {
      if (!mgmt.contract) throw new Error("Attach a contract first.");
      setMgmtMsg("Connecting signer…");
      const signer = await getSigner();
      const write = mgmt.contract.connect(signer);
      const your = await signer.getAddress();

      if (mgmt.admin && your.toLowerCase() !== mgmt.admin.toLowerCase()) {
        throw new Error(`You are not the admin. Admin is ${mgmt.admin}`);
      }

      setMgmtMsg("Trying endNow()…");
      try {
        const tx = await write.endNow();
        await tx.wait();
        setMgmtMsg("✅ Election ended via endNow().");
        const st = await mgmt.contract.status();
        setMgmt((m) => ({ ...m, status: st, you: your }));
        return;
      } catch {
        setMgmtMsg("endNow() not available; trying setEnd(now) / setWindow(…, now) …");
      }

      const now = Math.floor(Date.now() / 1000);

      try {
        const tx = await write.setEnd(now);
        await tx.wait();
        setMgmtMsg("✅ Election ended via setEnd(now).");
        const st = await mgmt.contract.status();
        setMgmt((m) => ({ ...m, endTs: now, status: st, you: your }));
        return;
      } catch {print}

      try {
        const tx = await write.setWindow(mgmt.startTs, now);
        await tx.wait();
        setMgmtMsg("✅ Election ended via setWindow(start, now).");
        const st = await mgmt.contract.status();
        setMgmt((m) => ({ ...m, endTs: now, status: st, you: your }));
        return;
      } catch {print}

      throw new Error(
        "This contract doesn’t expose an admin end function I recognize. " +
        "Add endNow()/setEnd()/setWindow() to the ABI or contract."
      );
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.reason || e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusyManage(false);                 // ✅
    }
  }

  return (
    <div className="page">
      <h1>Admin</h1>

      {/* Auth toggle used by BOTH panes */}
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
            <label className="field">
              <span>Admin Private Key (dev only)</span>
              <input
                type="password"
                className="input"
                value={adminPk}
                onChange={(e) => setAdminPk(e.target.value)}
                placeholder="0x… Hardhat Account #0 key"
              />
            </label>
            <div className="hint">⚠️ Dev-only. Never paste a real key here.</div>
          </>
        )}
      </section>

      {/* Tabs */}
      <div className="actions mb8">
        <button className="btn" onClick={() => setTab("create")} aria-pressed={tab === "create"}>
          Create Election
        </button>
        <button className="btn" onClick={() => setTab("manage")} aria-pressed={tab === "manage"}>
          Manage Existing
        </button>
      </div>

      {tab === "create" ? (
        <section className="card">
          <h2>Create Election</h2>

          <label className="field">
            <span>Title</span>
            <input className="input" value={title} onChange={e=>setTitle(e.target.value)} />
          </label>

          <label className="field">
            <span>Candidates (comma-separated)</span>
            <input
              className="input"
              value={cands}
              onChange={e=>setCands(e.target.value)}
              placeholder="Alice, Bob, Charlie"
            />
          </label>

          <div className="grid2">
            <label className="field">
              <span>Start (local)</span>
              <input type="datetime-local" className="input" value={start} onChange={e=>setStart(e.target.value)} />
            </label>
            <label className="field">
              <span>End (local)</span>
              <input type="datetime-local" className="input" value={end} onChange={e=>setEnd(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Eligible Voter Addresses (paste; only addresses are used)</span>
            <textarea
              className="input mono"
              style={{ minHeight: 120 }}
              value={voterBlob}
              onChange={(e)=>setVoterBlob(e.target.value)}
              placeholder={`Paste lines like:
Account #0: 0xf39F... (10000 ETH)
Account #1: 0x7099...
… etc …
`}
            />
          </label>

          <div className="actions">
            <button className="btn" onClick={deployAndRegister} disabled={busyCreate}>
              {busyCreate ? "Working…" : "Deploy & Register"}
            </button>
          </div>

          <div className="hint pre">{createMsg}</div>
          {deployedAddr && (
            <div className="kv mt8">
              <b>Contract:</b> <span className="mono">{deployedAddr}</span>
            </div>
          )}
        </section>
      ) : (
        <section className="card">
          <h2>Manage Existing</h2>

          <label className="field">
            <span>Contract Address</span>
            <input
              className="input mono"
              value={attachAddr}
              onChange={(e)=>setAttachAddr(e.target.value.trim())}
              placeholder="0x…"
            />
          </label>

          <div className="actions">
            <button className="btn" onClick={attach} disabled={busyManage}>
              {busyManage ? "Attaching…" : "Attach"}
            </button>
          </div>

          <div className="hint pre">{mgmtMsg}</div>

          {mgmt.contract && (
            <>
              <div className="kv mt8">
                <b>Admin:</b> <span className="mono">{mgmt.admin || "— (no admin() in ABI?)"}</span>
              </div>
              <div className="kv">
                <b>You:</b> <span className="mono">{mgmt.you || "— (connect signer above)"}</span>
              </div>
              <div className="kv"><b>Status:</b> {mgmt.status || "—"}</div>
              <div className="kv"><b>Title:</b> {mgmt.title || "—"}</div>
              <div className="kv"><b>Start:</b> {mgmt.startTs ? new Date(mgmt.startTs*1000).toLocaleString() : "—"}</div>
              <div className="kv"><b>End:</b> {mgmt.endTs ? new Date(mgmt.endTs*1000).toLocaleString() : "—"}</div>
              <div className="kv"><b>Admin? </b>{isAdmin ? "✅ yes" : "❌ no"}</div>

              <div className="actions mt12">
                <button className="btn" onClick={endElectionNow} disabled={!isAdmin || busyManage}>
                  {busyManage ? "Working…" : "End Election Now"}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
