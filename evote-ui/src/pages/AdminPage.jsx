// src/pages/AdminPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { ethers, NonceManager } from "ethers";
import votingArtifact from "../Voting.json";
import semaphoreArtifact from "../Semaphore.json";
import semaphoreVerifierArtifact from "../SemaphoreVerifier.json";
import poseidonArtifact from "../PoseidonT3.json";

const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";

const DEFAULT_ADDR = (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim();
const DEFAULT_RELAYER = (import.meta.env.VITE_RELAYER_ADDRESS || "").trim();

const MGMT_ABI = [
  "function admin() view returns (address)",
  "function relayer() view returns (address)",
  "function semaphore() view returns (address)",
  "function status() view returns (string)",
  "function electionInfo() view returns (string,uint64,uint64)",
  "function groupSize() view returns (uint256)",
  "function registerVoters(address[] addrs)",
  "function updateWindow(uint64 _startTs, uint64 _endTs)",
  "function updateRelayer(address newRelayer)",
  "function closeEarly()",
];

const toUnix = (s) => Math.floor(new Date(s).getTime() / 1000);

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
      // skip invalid candidates
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

function artifactBytecode(bytecode) {
  if (typeof bytecode === "string") return bytecode;
  if (bytecode && typeof bytecode.object === "string") return bytecode.object;
  return "";
}

function linkArtifactBytecode(artifact, libraries) {
  const raw = artifactBytecode(artifact?.bytecode);
  if (!raw || raw === "0x") {
    throw new Error(`Missing bytecode for ${artifact?.contractName || "contract"}.`);
  }

  const refs = artifact?.linkReferences || {};
  const fileNames = Object.keys(refs);
  if (fileNames.length === 0) return raw;

  const linked = raw.startsWith("0x") ? raw.slice(2).split("") : raw.split("");

  for (const fileName of fileNames) {
    const byLibrary = refs[fileName] || {};
    for (const libName of Object.keys(byLibrary)) {
      const fqName = `${fileName}:${libName}`;
      const libAddr = libraries[fqName] || libraries[libName];
      if (!libAddr || !ethers.isAddress(libAddr)) {
        throw new Error(`Missing linked library address for ${fqName}.`);
      }

      const addrHex = ethers.getAddress(libAddr).slice(2).toLowerCase();
      const positions = byLibrary[libName] || [];
      for (const pos of positions) {
        const start = pos.start * 2;
        const length = pos.length * 2;
        linked.splice(start, length, ...addrHex);
      }
    }
  }

  return `0x${linked.join("")}`;
}

export default function AdminPage() {
  const createLockRef = useRef(false);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, []);

  const [tab, setTab] = useState("create");

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
    }

    if (!window.ethereum) throw new Error("MetaMask not found");
    const bp = new ethers.BrowserProvider(window.ethereum);
    await bp.send("eth_requestAccounts", []);
    const base = await bp.getSigner();
    return new NonceManager(base);
  }

  const [title, setTitle] = useState("");
  const [cands, setCands] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [voterBlob, setVoterBlob] = useState("");
  const [createRelayer, setCreateRelayer] = useState(DEFAULT_RELAYER);
  const [createSemaphore, setCreateSemaphore] = useState(
    () => localStorage.getItem("last_semaphore") || ""
  );
  const [createMsg, setCreateMsg] = useState("");
  const [deployedAddr, setDeployedAddr] = useState("");
  const [busyCreate, setBusyCreate] = useState(false);

  async function deployAndRegister() {
    if (busyCreate || createLockRef.current) return;
    createLockRef.current = true;
    setBusyCreate(true);

    try {
      setCreateMsg(useLocal ? "Connecting Hardhat…" : "Connecting MetaMask…");
      const signer = await getSigner();
      const sp = signer?.provider || provider;
      if (!sp) throw new Error("Provider not ready.");

      if (!useLocal && provider) {
        const [walletNet, rpcNet] = await Promise.all([
          sp.getNetwork(),
          provider.getNetwork(),
        ]);
        if (walletNet.chainId !== rpcNet.chainId) {
          throw new Error(
            `Network mismatch. MetaMask is on chain ${walletNet.chainId.toString()}, but UI RPC is on chain ${rpcNet.chainId.toString()}.`
          );
        }
      }

      const startTs = toUnix(start);
      const endTs = toUnix(end);
      const candidates = cands
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const voters = parseAddresses(voterBlob);
      const relayerAddr = createRelayer.trim();

      if (!title || candidates.length < 2)
        throw new Error("Need a title and ≥ 2 candidates");
      if (!(startTs > 0 && endTs > startTs)) throw new Error("Bad time window");
      if (voters.length === 0)
        throw new Error("Provide at least one eligible voter address");
      if (!ethers.isAddress(relayerAddr))
        throw new Error("Provide a valid relayer address.");

      let semaphoreAddr = createSemaphore.trim();
      if (semaphoreAddr && !ethers.isAddress(semaphoreAddr)) {
        throw new Error("Semaphore address is invalid.");
      }

      if (!semaphoreAddr || !(await hasCode(sp, semaphoreAddr))) {
        setCreateMsg("Deploying Poseidon library…");
        const poseidonFactory = new ethers.ContractFactory(
          poseidonArtifact.abi,
          poseidonArtifact.bytecode,
          signer
        );
        const poseidon = await poseidonFactory.deploy();
        await poseidon.deploymentTransaction().wait();
        const poseidonAddr = await poseidon.getAddress();

        setCreateMsg("Deploying Semaphore verifier…");
        const verifierFactory = new ethers.ContractFactory(
          semaphoreVerifierArtifact.abi,
          semaphoreVerifierArtifact.bytecode,
          signer
        );
        const verifier = await verifierFactory.deploy();
        await verifier.deploymentTransaction().wait();

        setCreateMsg("Deploying Semaphore…");
        const linkedSemaphoreBytecode = linkArtifactBytecode(semaphoreArtifact, {
          "poseidon-solidity/PoseidonT3.sol:PoseidonT3": poseidonAddr,
          PoseidonT3: poseidonAddr,
        });
        const semaphoreFactory = new ethers.ContractFactory(
          semaphoreArtifact.abi,
          linkedSemaphoreBytecode,
          signer
        );
        const semaphore = await semaphoreFactory.deploy(await verifier.getAddress());
        await semaphore.deploymentTransaction().wait();

        semaphoreAddr = await semaphore.getAddress();
        setCreateSemaphore(semaphoreAddr);
        localStorage.setItem("last_semaphore", semaphoreAddr);
      }

      setCreateMsg(`Deploying election… (relayer: ${relayerAddr})`);
      const factory = new ethers.ContractFactory(
        votingArtifact.abi,
        votingArtifact.bytecode,
        signer
      );

      const contract = await factory.deploy(
        title,
        candidates,
        BigInt(startTs),
        BigInt(endTs),
        relayerAddr,
        semaphoreAddr
      );

      setCreateMsg("Waiting for election deployment confirmation…");
      const rcpt = await contract.deploymentTransaction().wait();
      const addr = rcpt.contractAddress ?? (await contract.getAddress());
      setDeployedAddr(addr);
      localStorage.setItem("last_contract", addr);

      const bound = new ethers.Contract(addr, votingArtifact.abi, signer);
      try {
        setCreateMsg(`Registering ${voters.length} voters…`);
        const regTx = await bound.registerVoters(voters);
        await regTx.wait();
      } catch (regErr) {
        const msg = regErr?.reason || regErr?.shortMessage || regErr?.message || String(regErr);
        setCreateMsg(
          `⚠️ Contract deployed, but voter registration failed.\nContract: ${addr}\nRelayer: ${relayerAddr}\nSemaphore: ${semaphoreAddr}\nError: ${msg}`
        );
        return;
      }

      setCreateMsg(
        `✅ Deployed & registered.\nContract: ${addr}\nRelayer: ${relayerAddr}\nSemaphore: ${semaphoreAddr}`
      );
    } catch (e) {
      console.error(e);
      setCreateMsg("❌ " + (e.reason || e.shortMessage || e.message || String(e)));
    } finally {
      createLockRef.current = false;
      setBusyCreate(false);
    }
  }

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
    relayer: "",
    semaphore: "",
    you: "",
    title: "",
    startTs: 0,
    endTs: 0,
    status: "",
    groupSize: 0,
  });
  const [busyManage, setBusyManage] = useState(false);

  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [moreVotersBlob, setMoreVotersBlob] = useState("");
  const [newRelayer, setNewRelayer] = useState("");

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
      const admin = await c.admin();
      const relayer = await c.relayer();
      const semaphore = await c.semaphore();
      const [nm, sTs, eTs] = await c.electionInfo();
      const st = await c.status();
      const groupSize = Number(await c.groupSize());

      let you = "";
      try {
        const signer = await getSigner();
        you = await signer.getAddress();
      } catch {
        // ignore
      }

      const sNum = Number(sTs);
      const eNum = Number(eTs);

      setMgmt({
        contract: c,
        admin,
        relayer,
        semaphore,
        you,
        title: nm,
        startTs: sNum,
        endTs: eNum,
        status: st,
        groupSize,
      });

      setNewStart(toLocalInputValue(sNum));
      setNewEnd(toLocalInputValue(eNum));
      setNewRelayer(relayer);

      setMgmtMsg("✅ Attached.");
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.message || String(e)));
      setMgmt({
        contract: null,
        admin: "",
        relayer: "",
        semaphore: "",
        you: "",
        title: "",
        startTs: 0,
        endTs: 0,
        status: "",
        groupSize: 0,
      });
      setNewStart("");
      setNewEnd("");
      setMoreVotersBlob("");
      setNewRelayer("");
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

      if (mgmt.admin && your.toLowerCase() !== mgmt.admin.toLowerCase()) {
        throw new Error(`You are not the admin. Admin is ${mgmt.admin}`);
      }

      setMgmtMsg("Ending election…");
      const tx = await write.closeEarly();
      setMgmtMsg(`Waiting for confirmation… (tx: ${tx.hash})`);
      await tx.wait();

      const [, sTs, eTs] = await mgmt.contract.electionInfo();
      const st = await mgmt.contract.status();

      const sNum = Number(sTs);
      const eNum = Number(eTs);

      setMgmt((m) => ({ ...m, startTs: sNum, endTs: eNum, status: st, you: your }));
      setNewStart(toLocalInputValue(sNum));
      setNewEnd(toLocalInputValue(eNum));

      setMgmtMsg("✅ Election ended (closeEarly confirmed).");
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.reason || e?.shortMessage || e?.message || String(e)));
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

      setMgmt((m) => ({ ...m, startTs: sNum, endTs: eNum, status: st, you: your }));
      setNewStart(toLocalInputValue(sNum));
      setNewEnd(toLocalInputValue(eNum));

      setMgmtMsg("✅ Election window updated.");
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.reason || e?.shortMessage || e?.message || String(e)));
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

      const BATCH = 200;
      setMgmtMsg(`Registering ${addrs.length} voters…`);

      for (let i = 0; i < addrs.length; i += BATCH) {
        const chunk = addrs.slice(i, i + BATCH);
        const tx = await write.registerVoters(chunk);
        setMgmtMsg(
          `Registering ${addrs.length} voters… (batch ${
            Math.floor(i / BATCH) + 1
          }/${Math.ceil(addrs.length / BATCH)})`
        );
        await tx.wait();
      }

      setMoreVotersBlob("");
      const st = await mgmt.contract.status();
      setMgmt((m) => ({ ...m, status: st, you: your }));

      setMgmtMsg(`✅ Registered ${addrs.length} additional voters.`);
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.reason || e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusyManage(false);
    }
  }

  async function updateRelayer() {
    if (busyManage) return;
    setBusyManage(true);

    try {
      if (!mgmt.contract) throw new Error("Attach a contract first.");
      if (!ethers.isAddress(newRelayer)) throw new Error("Bad relayer address.");

      const signer = await getSigner();
      const write = mgmt.contract.connect(signer);
      const your = await signer.getAddress();

      if (mgmt.admin && your.toLowerCase() !== mgmt.admin.toLowerCase()) {
        throw new Error(`You are not the admin. Admin is ${mgmt.admin}`);
      }

      const tx = await write.updateRelayer(newRelayer);
      setMgmtMsg(`Updating relayer… (tx: ${tx.hash})`);
      await tx.wait();

      setMgmt((m) => ({ ...m, relayer: ethers.getAddress(newRelayer), you: your }));
      setMgmtMsg("✅ Relayer updated.");
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.reason || e?.shortMessage || e?.message || String(e)));
    } finally {
      setBusyManage(false);
    }
  }

  return (
    <div className="page" data-testid="admin-page">
      <h1>Admin</h1>

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
            <span>Relayer Address</span>
            <input
              className="input mono"
              value={createRelayer}
              onChange={(e) => setCreateRelayer(e.target.value.trim())}
              placeholder="0x… relayer wallet"
            />
          </label>

          <label className="field">
            <span>Semaphore Address (optional, auto-deploy if empty)</span>
            <input
              className="input mono"
              value={createSemaphore}
              onChange={(e) => setCreateSemaphore(e.target.value.trim())}
              placeholder="0x…"
            />
          </label>
          <div className="hint">
            If empty, deployment includes Poseidon + Semaphore verifier + Semaphore + Voting +
            voter registration (multiple MetaMask confirmations and gas).
          </div>

          <label className="field">
            <span>Eligible Voter Addresses (paste; only addresses are used)</span>
            <textarea
              className="input mono"
              data-testid="create-voters"
              style={{ minHeight: 120 }}
              value={voterBlob}
              onChange={(e) => setVoterBlob(e.target.value)}
              placeholder={`Paste lines like:\nAccount #1: 0x...\nAccount #2: 0x...`}
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
              <div className="kv mt8">
                <b>Admin:</b> <span className="mono">{mgmt.admin}</span>
              </div>
              <div className="kv">
                <b>You:</b> <span className="mono">{mgmt.you || "—"}</span>
              </div>
              <div className="kv">
                <b>Relayer:</b> <span className="mono">{mgmt.relayer || "—"}</span>
              </div>
              <div className="kv">
                <b>Semaphore:</b>{" "}
                <span className="mono">{mgmt.semaphore || "—"}</span>
              </div>
              <div className="kv">
                <b>Status:</b> {mgmt.status || "—"}
              </div>
              <div className="kv">
                <b>Title:</b> {mgmt.title || "—"}
              </div>
              <div className="kv">
                <b>Start:</b> {fmtTs(mgmt.startTs)}
              </div>
              <div className="kv">
                <b>End:</b> {fmtTs(mgmt.endTs)}
              </div>
              <div className="kv">
                <b>Linked Identities:</b> {mgmt.groupSize}
              </div>
              <div className="kv">
                <b>Admin?</b> {isAdmin ? "✅ yes" : "❌ no"}
              </div>

              <div className="kv mt12">
                <b>Update Relayer</b>
              </div>
              <label className="field">
                <span>New Relayer Address</span>
                <input
                  className="input mono"
                  value={newRelayer}
                  onChange={(e) => setNewRelayer(e.target.value.trim())}
                  disabled={!isAdmin || busyManage}
                  placeholder="0x…"
                />
              </label>
              <div className="actions mt8">
                <button
                  className="btn"
                  onClick={updateRelayer}
                  disabled={!isAdmin || busyManage}
                >
                  Update Relayer
                </button>
              </div>

              <div className="kv mt12">
                <b>Update Window (before start)</b>
              </div>
              <div className="grid2">
                <label className="field">
                  <span>New Start (local)</span>
                  <input
                    type="datetime-local"
                    step="1"
                    className="input"
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
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    disabled={!isAdmin || busyManage || hasStarted}
                  />
                </label>
              </div>
              <div className="actions mt8">
                <button
                  className="btn"
                  onClick={updateElectionWindow}
                  disabled={!isAdmin || busyManage || hasStarted}
                >
                  Update Window
                </button>
              </div>

              <div className="kv mt12">
                <b>Register More Voters (before start)</b>
              </div>
              <label className="field">
                <span>Additional Voter Addresses</span>
                <textarea
                  className="input mono"
                  style={{ minHeight: 100 }}
                  value={moreVotersBlob}
                  onChange={(e) => setMoreVotersBlob(e.target.value)}
                  placeholder={`Paste addresses here:\n0xabc...\n0xdef...`}
                  disabled={!isAdmin || busyManage || hasStarted}
                />
              </label>
              <div className="actions mt8">
                <button
                  className="btn"
                  onClick={registerMoreVoters}
                  disabled={!isAdmin || busyManage || hasStarted}
                >
                  Register More Voters
                </button>
              </div>

              <div className="actions mt12">
                <button
                  className="btn"
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
