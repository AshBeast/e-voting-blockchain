// src/pages/AdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { ethers, NonceManager } from "ethers";
import votingArtifact from "../Voting.json";
import forwarderArtifact from "../Forwarder.json";

// Prefer remote RPC (Sepolia) if set, otherwise local Hardhat, otherwise default localhost
const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";

const DEFAULT_ADDR = (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim();
const ENV_FORWARDER = (import.meta.env.VITE_FORWARDER_ADDRESS || "").trim();

const MGMT_ABI = [
  "function admin() view returns (address)",
  "function status() view returns (string)",
  "function electionInfo() view returns (string,uint64,uint64)",
  "function registerVoters(address[] addrs)",
  "function updateWindow(uint64 _startTs, uint64 _endTs)",
  "function closeEarly()",
];

/* ------------ helpers ------------ */
const toUnix = (s) => Math.floor(new Date(s).getTime() / 1000);

// unix seconds -> "YYYY-MM-DDTHH:MM:SS" (local time) for datetime-local inputs
function toLocalInputValue(tsSec) {
  if (!tsSec) return "";
  const d = new Date(tsSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtTs(tsSec) {
  if (!tsSec) return "—";
  return new Date(tsSec * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// do NOT early-return on a bad token; just skip it
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

  useEffect(() => {
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, []);

  /* --------------- tabs --------------- */
  const [tab, setTab] = useState("create"); // "create" | "manage"

  /* --------------- auth mode --------------- */
  // persist auth prefs so reload keeps your “login”
  const [useLocal, setUseLocal] = useState(
    () => localStorage.getItem("admin.useLocal") === "1"
  );
  const [adminPk, setAdminPk] = useState(
    () => localStorage.getItem("admin.pk") || ""
  );

  useEffect(() => {
    localStorage.setItem("admin.useLocal", useLocal ? "1" : "0");
  }, [useLocal]);

  useEffect(() => {
    if (adminPk?.startsWith("0x")) localStorage.setItem("admin.pk", adminPk);
  }, [adminPk]);

  async function getSigner() {
    if (useLocal) {
      if (!adminPk || !adminPk.startsWith("0x")) {
        throw new Error("Enter the admin private key (0x…) for local mode.");
      }
      if (!provider) throw new Error("Provider not ready (RPC misconfigured).");
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
  const [busyCreate, setBusyCreate] = useState(false);

  async function deployAndRegister() {
    if (busyCreate) return; // guard against double clicks
    setBusyCreate(true);
    try {
      setCreateMsg(useLocal ? "Connecting Hardhat…" : "Connecting MetaMask…");
      const signer = await getSigner();
      const sp = signer?.provider || provider;
      if (!sp) throw new Error("Provider not ready.");

      const startTs = toUnix(start);
      const endTs = toUnix(end);
      const candidates = cands
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const voters = parseAddresses(voterBlob);

      if (!title || candidates.length < 2)
        throw new Error("Need a title and ≥ 2 candidates");
      if (!(startTs > 0 && endTs > startTs)) throw new Error("Bad time window");
      if (voters.length === 0)
        throw new Error("Provide at least one eligible voter address");

      // --- 1) Get / deploy forwarder (trustedForwarder) ---
      let forwarderAddr = "";

      // Prefer: ENV var -> last_forwarder -> deploy new
      const lastForwarder = (localStorage.getItem("last_forwarder") || "").trim();

      const candidatesForwarderAddrs = [ENV_FORWARDER, lastForwarder].filter(Boolean);

      for (const candAddr of candidatesForwarderAddrs) {
        if (ethers.isAddress(candAddr) && (await hasCode(sp, candAddr))) {
          forwarderAddr = ethers.getAddress(candAddr);
          break;
        }
      }

      if (!forwarderAddr) {
        setCreateMsg("Deploying trusted forwarder…");
        const fFactory = new ethers.ContractFactory(
          forwarderArtifact.abi,
          forwarderArtifact.bytecode,
          signer
        );

        // Most forwarders (e.g., OZ MinimalForwarder) have no constructor args
        const fwd = await fFactory.deploy();
        setCreateMsg("Waiting for forwarder deployment confirmation…");
        await fwd.deploymentTransaction().wait();
        forwarderAddr = await fwd.getAddress();

        localStorage.setItem("last_forwarder", forwarderAddr);
      }

      // --- 2) Deploy Voting with NEW constructor (5 args) ---
      setCreateMsg(`Deploying election… (forwarder: ${forwarderAddr})`);
      const factory = new ethers.ContractFactory(
        votingArtifact.abi,
        votingArtifact.bytecode,
        signer
      );

      // NEW constructor signature: (title, candidates, startTs, endTs, trustedForwarder)
      const contract = await factory.deploy(
        title,
        candidates,
        BigInt(startTs),
        BigInt(endTs),
        forwarderAddr
      );

      setCreateMsg("Waiting for election deployment confirmation…");
      const rcpt = await contract.deploymentTransaction().wait();
      const addr = rcpt.contractAddress ?? (await contract.getAddress());
      setDeployedAddr(addr);

      // remember last deployed for quick use
      localStorage.setItem("last_contract", addr);

      // --- 3) Register voters ---
      const bound = new ethers.Contract(addr, votingArtifact.abi, signer);
      setCreateMsg(`Registering ${voters.length} voters…`);
      const regTx = await bound.registerVoters(voters);
      await regTx.wait();

      setCreateMsg(
        `✅ Deployed & registered.\nContract: ${addr}\nForwarder: ${forwarderAddr}`
      );
    } catch (e) {
      console.error(e);
      setCreateMsg(
        "❌ " + (e.reason || e.shortMessage || e.message || String(e))
      );
    } finally {
      setBusyCreate(false);
    }
  }

  /* ============= MANAGE EXISTING ============= */
  const [attachAddr, setAttachAddr] = useState(
    () => localStorage.getItem("admin.attach") || DEFAULT_ADDR
  );
  useEffect(() => {
    if (attachAddr) localStorage.setItem("admin.attach", attachAddr);
  }, [attachAddr]);

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
  const [busyManage, setBusyManage] = useState(false);

  // manage inputs (seconds-capable)
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  // register more voters before start
  const [moreVotersBlob, setMoreVotersBlob] = useState("");

  const isAdmin = useMemo(() => {
    return (
      mgmt.admin &&
      mgmt.you &&
      mgmt.admin.toLowerCase() === mgmt.you.toLowerCase()
    );
  }, [mgmt.admin, mgmt.you]);

  const nowSec = Math.floor(Date.now() / 1000);
  const hasStarted = mgmt.startTs ? nowSec >= mgmt.startTs : false;

  async function attach() {
    if (busyManage) return;
    setBusyManage(true);
    try {
      setMgmtMsg("Checking address…");
      if (!ethers.isAddress(attachAddr))
        throw new Error("Enter a valid contract address.");
      if (!provider) throw new Error("Provider not ready.");

      const ok = await hasCode(provider, attachAddr);
      if (!ok)
        throw new Error("No contract code at this address on current RPC.");

      const c = new ethers.Contract(attachAddr, MGMT_ABI, provider);

      setMgmtMsg("Loading election info…");
      let admin = "";
      try {
        admin = await c.admin();
      } catch {
        // admin() might not exist; ignore
      }

      const [nm, sTs, eTs] = await c.electionInfo();
      const st = await c.status();

      // who are you?
      let you = "";
      try {
        const signer = await getSigner();
        you = await signer.getAddress();
      } catch {
        // signer might not be available; ignore
      }

      const sNum = Number(sTs);
      const eNum = Number(eTs);

      setMgmt({
        contract: c,
        admin,
        you,
        title: nm,
        startTs: sNum,
        endTs: eNum,
        status: st,
      });

      // Prefill window fields (with seconds)
      setNewStart(toLocalInputValue(sNum));
      setNewEnd(toLocalInputValue(eNum));

      setMgmtMsg("✅ Attached.");
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.message || String(e)));
      setMgmt({
        contract: null,
        admin: "",
        you: "",
        title: "",
        startTs: 0,
        endTs: 0,
        status: "",
      });
      setNewStart("");
      setNewEnd("");
      setMoreVotersBlob("");
    } finally {
      setBusyManage(false);
    }
  }

  async function endElectionNow() {
    if (busyManage) return;
    setBusyManage(true);

    try {
      if (!mgmt.contract) throw new Error("Attach a contract first.");

      setMgmtMsg("Connecting signer…");
      const signer = await getSigner();
      const write = mgmt.contract.connect(signer);
      const your = await signer.getAddress();

      // Admin check (only if admin was readable)
      if (mgmt.admin && your.toLowerCase() !== mgmt.admin.toLowerCase()) {
        throw new Error(`You are not the admin. Admin is ${mgmt.admin}`);
      }

      // Execute closeEarly()
      setMgmtMsg("Ending election…");
      const tx = await write.closeEarly();
      setMgmtMsg(`Waiting for confirmation… (tx: ${tx.hash})`);
      await tx.wait();

      // Refresh from chain
      const [, sTs, eTs] = await mgmt.contract.electionInfo();
      const st = await mgmt.contract.status();

      const sNum = Number(sTs);
      const eNum = Number(eTs);

      setMgmt((m) => ({
        ...m,
        startTs: sNum,
        endTs: eNum,
        status: st,
        you: your,
      }));

      // Keep window inputs aligned
      setNewStart(toLocalInputValue(sNum));
      setNewEnd(toLocalInputValue(eNum));

      setMgmtMsg("✅ Election ended (closeEarly confirmed).");
      return;
    } catch (e) {
      console.error(e);
      setMgmtMsg(
        "❌ " + (e?.reason || e?.shortMessage || e?.message || String(e))
      );
    } finally {
      setBusyManage(false);
    }
  }

  async function updateElectionWindow() {
    if (busyManage) return;
    setBusyManage(true);

    try {
      if (!mgmt.contract) throw new Error("Attach a contract first.");

      if (hasStarted)
        throw new Error("Election already started. Window cannot be updated.");

      setMgmtMsg("Connecting signer…");
      const signer = await getSigner();
      const write = mgmt.contract.connect(signer);
      const your = await signer.getAddress();

      if (mgmt.admin && your.toLowerCase() !== mgmt.admin.toLowerCase()) {
        throw new Error(`You are not the admin. Admin is ${mgmt.admin}`);
      }

      const s = toUnix(newStart);
      const now = Math.floor(Date.now() / 1000);
      if (s <= now) throw new Error("New start time must be in the future.");

      const e = toUnix(newEnd);
      if (!(s > 0 && e > s)) throw new Error("Bad time window.");

      setMgmtMsg("Updating election window…");
      const tx = await write.updateWindow(BigInt(s), BigInt(e));
      setMgmtMsg(`Waiting for confirmation… (tx: ${tx.hash})`);
      await tx.wait();

      const [, sTs, eTs] = await mgmt.contract.electionInfo();
      const st = await mgmt.contract.status();

      const sNum = Number(sTs);
      const eNum = Number(eTs);

      setMgmt((m) => ({
        ...m,
        startTs: sNum,
        endTs: eNum,
        status: st,
        you: your,
      }));

      setNewStart(toLocalInputValue(sNum));
      setNewEnd(toLocalInputValue(eNum));

      setMgmtMsg("✅ Election window updated.");
      return;
    } catch (e) {
      console.error(e);
      setMgmtMsg(
        "❌ " + (e?.reason || e?.shortMessage || e?.message || String(e))
      );
    } finally {
      setBusyManage(false);
    }
  }

  async function registerMoreVoters() {
    if (busyManage) return;
    setBusyManage(true);

    try {
      if (!mgmt.contract) throw new Error("Attach a contract first.");

      if (hasStarted)
        throw new Error("Election already started. Registration is closed.");

      const addrs = parseAddresses(moreVotersBlob);
      if (addrs.length === 0)
        throw new Error("Paste at least one voter address.");

      setMgmtMsg("Connecting signer…");
      const signer = await getSigner();
      const write = mgmt.contract.connect(signer);
      const your = await signer.getAddress();

      if (mgmt.admin && your.toLowerCase() !== mgmt.admin.toLowerCase()) {
        throw new Error(`You are not the admin. Admin is ${mgmt.admin}`);
      }

      // Batch to avoid gas blowups
      const BATCH = 200;
      setMgmtMsg(`Registering ${addrs.length} voters…`);

      for (let i = 0; i < addrs.length; i += BATCH) {
        const chunk = addrs.slice(i, i + BATCH);
        const tx = await write.registerVoters(chunk);
        setMgmtMsg(
          `Registering ${addrs.length} voters… (batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(
            addrs.length / BATCH
          )})`
        );
        await tx.wait();
      }

      setMoreVotersBlob("");

      const st = await mgmt.contract.status();
      setMgmt((m) => ({ ...m, status: st, you: your }));

      setMgmtMsg(
        `✅ Registered ${addrs.length} additional voters. (or was already registered)`
      );
      return;
    } catch (e) {
      console.error(e);
      setMgmtMsg(
        "❌ " + (e?.reason || e?.shortMessage || e?.message || String(e))
      );
    } finally {
      setBusyManage(false);
    }
  }

  return (
    <div className="page" data-testid="admin-page">
      <h1>Admin</h1>

      {/* Auth toggle used by BOTH panes */}
      <section className="card" data-testid="admin-auth-card">
        <label className="field">
          <span>
            <input
              type="checkbox"
              data-testid="admin-use-local-toggle"
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
                data-testid="admin-private-key"
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
      <div className="actions mb8" data-testid="admin-tabs">
        <button
          className="btn"
          data-testid="tab-create"
          onClick={() => setTab("create")}
          aria-pressed={tab === "create"}
        >
          Create Election
        </button>
        <button
          className="btn"
          data-testid="tab-manage"
          onClick={() => setTab("manage")}
          aria-pressed={tab === "manage"}
        >
          Manage Existing
        </button>
      </div>

      {tab === "create" ? (
        <section className="card" data-testid="create-election-card">
          <h2>Create Election</h2>

          <label className="field">
            <span>Title</span>
            <input
              className="input"
              data-testid="create-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Candidates (comma-separated)</span>
            <input
              className="input"
              data-testid="create-candidates"
              value={cands}
              onChange={(e) => setCands(e.target.value)}
              placeholder="Alice, Bob, Charlie"
            />
          </label>

          <div className="grid2" data-testid="create-window-grid">
            <label className="field">
              <span>Start (local)</span>
              <input
                type="datetime-local"
                step="1"
                className="input"
                data-testid="create-start"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="field">
              <span>End (local)</span>
              <input
                type="datetime-local"
                step="1"
                className="input"
                data-testid="create-end"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span>Eligible Voter Addresses (paste; only addresses are used)</span>
            <textarea
              className="input mono"
              data-testid="create-voters"
              style={{ minHeight: 120 }}
              value={voterBlob}
              onChange={(e) => setVoterBlob(e.target.value)}
              placeholder={`Paste lines like:
Account #0: 0xf39F... (10000 ETH)
Account #1: 0x7099...
… etc …
`}
            />
          </label>

          <div className="actions">
            <button
              className="btn"
              data-testid="create-deploy-register"
              onClick={deployAndRegister}
              disabled={busyCreate}
            >
              {busyCreate ? "Working…" : "Deploy & Register"}
            </button>
          </div>

          <div className="hint pre" data-testid="create-message">
            {createMsg}
          </div>

          {deployedAddr && (
            <div className="kv mt8" data-testid="create-contract-row">
              <b>Contract:</b>{" "}
              <span className="mono" data-testid="create-contract-address">
                {deployedAddr}
              </span>
            </div>
          )}
        </section>
      ) : (
        <section className="card" data-testid="manage-existing-card">
          <h2>Manage Existing</h2>

          <label className="field">
            <span>Contract Address</span>
            <input
              className="input mono"
              data-testid="manage-contract-address"
              value={attachAddr}
              onChange={(e) => setAttachAddr(e.target.value.trim())}
              placeholder="0x…"
            />
          </label>

          <div className="actions">
            <button
              className="btn"
              data-testid="manage-attach"
              onClick={attach}
              disabled={busyManage}
            >
              {busyManage ? "Attaching…" : "Attach"}
            </button>
          </div>

          <div className="hint pre" data-testid="manage-message">
            {mgmtMsg}
          </div>

          {mgmt.contract && (
            <div data-testid="manage-details">
              <div className="kv mt8" data-testid="manage-admin-row">
                <b>Admin:</b>{" "}
                <span className="mono" data-testid="manage-admin">
                  {mgmt.admin || "— (no admin() in ABI?)"}
                </span>
              </div>

              <div className="kv" data-testid="manage-you-row">
                <b>You:</b>{" "}
                <span className="mono" data-testid="manage-you">
                  {mgmt.you || "— (connect signer above)"}
                </span>
              </div>

              <div className="kv" data-testid="manage-status-row">
                <b>Status:</b>{" "}
                <span data-testid="manage-status">{mgmt.status || "—"}</span>
              </div>

              <div className="kv" data-testid="manage-title-row">
                <b>Title:</b>{" "}
                <span data-testid="manage-title">{mgmt.title || "—"}</span>
              </div>

              <div className="kv" data-testid="manage-start-row">
                <b>Start:</b>{" "}
                <span data-testid="manage-start">{fmtTs(mgmt.startTs)}</span>
              </div>

              <div className="kv" data-testid="manage-end-row">
                <b>End:</b>{" "}
                <span data-testid="manage-end">{fmtTs(mgmt.endTs)}</span>
              </div>

              <div className="kv" data-testid="manage-isadmin-row">
                <b>Admin? </b>
                <span data-testid="manage-isadmin">
                  {isAdmin ? "✅ yes" : "❌ no"}
                </span>
              </div>

              {/* Update Window (before start) */}
              <div className="kv mt12" data-testid="manage-update-window-title">
                <b>Update Window (before start)</b>
              </div>

              <div className="grid2" data-testid="manage-update-window-grid">
                <label className="field">
                  <span>New Start (local)</span>
                  <input
                    type="datetime-local"
                    step="1"
                    className="input"
                    data-testid="manage-new-start"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    disabled={!isAdmin || busyManage || hasStarted}
                  />
                </label>

                <label className="field">
                  <span>New End (local)</span>
                  <input
                    type="datetime-local"
                    step="1"
                    className="input"
                    data-testid="manage-new-end"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    disabled={!isAdmin || busyManage || hasStarted}
                  />
                </label>
              </div>

              <div className="actions mt8">
                <button
                  className="btn"
                  data-testid="manage-update-window"
                  onClick={updateElectionWindow}
                  disabled={!isAdmin || busyManage || hasStarted}
                >
                  Update Window
                </button>
              </div>

              {/* Register More Voters (before start) */}
              <div className="kv mt12" data-testid="manage-register-more-title">
                <b>Register More Voters (before start)</b>
              </div>

              <label className="field">
                <span>Additional Voter Addresses</span>
                <textarea
                  className="input mono"
                  data-testid="manage-more-voters"
                  style={{ minHeight: 100 }}
                  value={moreVotersBlob}
                  onChange={(e) => setMoreVotersBlob(e.target.value)}
                  placeholder={`Paste addresses here:
0xabc...
0xdef...
`}
                  disabled={!isAdmin || busyManage || hasStarted}
                />
              </label>

              <div className="actions mt8">
                <button
                  className="btn"
                  data-testid="manage-register-more"
                  onClick={registerMoreVoters}
                  disabled={!isAdmin || busyManage || hasStarted}
                >
                  Register More Voters
                </button>
              </div>

              {/* End Election Now */}
              <div className="actions mt12">
                <button
                  className="btn"
                  data-testid="manage-end-now"
                  onClick={endElectionNow}
                  disabled={!isAdmin || busyManage}
                >
                  {busyManage ? "Working…" : "End Election Now"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
