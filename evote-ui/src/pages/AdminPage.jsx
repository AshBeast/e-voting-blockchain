// src/pages/AdminPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { ethers, NonceManager } from "ethers";
import { useNavigate } from "react-router-dom";
import votingArtifact from "../Voting.json";
import semaphoreArtifact from "../Semaphore.json";
import semaphoreVerifierArtifact from "../SemaphoreVerifier.json";
import poseidonArtifact from "../PoseidonT3.json";
import UiIcon from "../components/UiIcon";
import { addKnownElectionAddress } from "../lib/electionStore";

const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:8787";

const DEFAULT_ADDR = (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim();
const DEFAULT_RELAYER = (import.meta.env.VITE_RELAYER_ADDRESS || "").trim();
const PENDING_DEPLOY_KEY = "admin.pendingDeployTx";
const ADMIN_DRAFT_KEYS = {
  tab: "admin.tab",
  createTitle: "admin.create.title",
  createCandidates: "admin.create.candidates",
  createStart: "admin.create.start",
  createEnd: "admin.create.end",
  createVoters: "admin.create.voters",
  createRelayer: "admin.create.relayer",
  createSemaphore: "admin.create.semaphore",
  manageNewStart: "admin.manage.newStart",
  manageNewEnd: "admin.manage.newEnd",
  manageMoreVoters: "admin.manage.moreVoters",
  manageNewRelayer: "admin.manage.newRelayer",
};

const MGMT_ABI = [
  "event VoterRegistered(address indexed voter)",
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
const MY_ELECTIONS_PAGE_SIZE = 10;

async function loadElectionEntriesFromRelayer(chainId, page, pageSize) {
  const query = new URLSearchParams({
    chainId: String(chainId),
    page: String(page),
    pageSize: String(pageSize),
  });
  const url = `${RELAYER_URL}/elections?${query.toString()}`;
  const r = await fetch(url);
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(out?.error || "Failed to load election registry.");
  }

  const list = Array.isArray(out?.elections) ? out.elections : [];
  const dedup = new Map();
  for (const item of list) {
    const raw = item?.address;
    if (typeof raw !== "string") continue;
    try {
      const address = ethers.getAddress(raw);
      if (!dedup.has(address)) {
        dedup.set(address, {
          address,
          title: typeof item?.title === "string" ? item.title : "",
          startTs:
            item?.startTs == null || item?.startTs === "" ? 0 : Number(item.startTs),
          endTs: item?.endTs == null || item?.endTs === "" ? 0 : Number(item.endTs),
        });
      }
    } catch {
      // ignore malformed address rows
    }
  }

  return {
    entries: Array.from(dedup.values()),
    page: Number(out?.page || page),
    totalPages: Math.max(1, Number(out?.totalPages || 1)),
    total: Math.max(0, Number(out?.total || 0)),
  };
}

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
      // Accept non-checksummed mixed-case inputs by normalizing to lowercase first.
      try {
        const ck = ethers.getAddress(a.toLowerCase());
        if (!seen.has(ck)) {
          seen.add(ck);
          out.push(ck);
        }
      } catch {
        // skip invalid candidates
      }
    }
  }
  return out;
}

function firstAddress(input) {
  if (typeof input !== "string") return "";
  const m = input.match(/0x[a-fA-F0-9]{40}\b/);
  if (!m) return "";
  try {
    return ethers.getAddress(m[0]);
  } catch {
    try {
      return ethers.getAddress(m[0].toLowerCase());
    } catch {
      return "";
    }
  }
}

function mergeAddressLists(...lists) {
  const byLower = new Map();
  for (const list of lists) {
    for (const addr of list) {
      if (!addr) continue;
      byLower.set(addr.toLowerCase(), addr);
    }
  }
  return Array.from(byLower.values());
}

async function fetchRegisteredVoterCount(contract) {
  try {
    const logs = await contract.queryFilter(contract.filters.VoterRegistered(), 0, "latest");
    const unique = new Set();
    for (const log of logs) {
      const voter = log?.args?.voter ?? log?.args?.[0];
      if (typeof voter === "string" && ethers.isAddress(voter)) {
        unique.add(ethers.getAddress(voter).toLowerCase());
      }
    }
    return unique.size;
  } catch {
    return null;
  }
}

async function hasCode(provider, addr) {
  try {
    const code = await provider.getCode(addr);
    return !!code && code !== "0x";
  } catch {
    return false;
  }
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getPendingDeploy() {
  const parsed = safeJsonParse(localStorage.getItem(PENDING_DEPLOY_KEY), null);
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.hash || !parsed.chainId) return null;
  return parsed;
}

function setPendingDeploy(pending) {
  localStorage.setItem(PENDING_DEPLOY_KEY, JSON.stringify(pending));
}

function clearPendingDeploy() {
  localStorage.removeItem(PENDING_DEPLOY_KEY);
}

async function isSemaphoreContract(provider, addr) {
  try {
    const c = new ethers.Contract(
      addr,
      ["function groupCounter() view returns (uint256)"],
      provider
    );
    await c.groupCounter();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMsg(e) {
  return e?.reason || e?.shortMessage || e?.message || String(e);
}

async function waitForReceiptWithRecovery(tx, provider) {
  if (!tx) throw new Error("Missing transaction response.");

  try {
    return await tx.wait();
  } catch (e) {
    if (e?.code === "TRANSACTION_REPLACED") {
      if (e?.cancelled) throw new Error("Transaction was cancelled in wallet.");
      if (e?.receipt) return e.receipt;
      if (e?.replacement?.wait) {
        return await e.replacement.wait();
      }
    }

    const hashes = [];
    const maybeHashes = [
      e?.transactionHash,
      e?.replacement?.hash,
      e?.transaction?.hash,
      tx?.hash,
    ];
    for (const h of maybeHashes) {
      if (typeof h === "string" && h.startsWith("0x") && h.length === 66) hashes.push(h);
    }

    if (provider && hashes.length > 0) {
      const unique = Array.from(new Set(hashes));
      for (let i = 0; i < 10; i++) {
        for (const hash of unique) {
          const rcpt = await provider.getTransactionReceipt(hash).catch(() => null);
          if (rcpt) return rcpt;
        }
        if (i < 9) await sleep(2000);
      }
    }

    throw e;
  }
}

async function waitForReceiptWithTimeout(tx, provider, timeoutMs = 180_000) {
  return await Promise.race([
    waitForReceiptWithRecovery(tx, provider),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            "Timed out waiting for transaction confirmation. Check wallet/network and tx hash."
          )
        );
      }, timeoutMs);
    }),
  ]);
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
  const navigate = useNavigate();
  const createLockRef = useRef(false);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, []);

  const [tab, setTab] = useState(() => {
    const saved = localStorage.getItem(ADMIN_DRAFT_KEYS.tab);
    return saved === "manage" || saved === "mine" ? saved : "create";
  });

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

  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.tab, tab);
  }, [tab]);

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

  const [title, setTitle] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.createTitle) || ""
  );
  const [candidateInputs, setCandidateInputs] = useState(() => {
    const saved = safeJsonParse(localStorage.getItem(ADMIN_DRAFT_KEYS.createCandidates), null);
    if (Array.isArray(saved)) {
      const normalized = saved.map((s) => String(s ?? ""));
      if (normalized.length >= 2) return normalized;
    }
    return ["", ""];
  });
  const [start, setStart] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.createStart) || ""
  );
  const [end, setEnd] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.createEnd) || ""
  );
  const [voterBlob, setVoterBlob] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.createVoters) || ""
  );
  const [createVoterImportMsg, setCreateVoterImportMsg] = useState("");
  const [createRelayer, setCreateRelayer] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.createRelayer) || DEFAULT_RELAYER
  );
  const [createSemaphore, setCreateSemaphore] = useState(
    () =>
      localStorage.getItem(ADMIN_DRAFT_KEYS.createSemaphore) ||
      localStorage.getItem("last_semaphore") ||
      ""
  );
  const [createMsg, setCreateMsg] = useState("");
  const [deployedAddr, setDeployedAddr] = useState("");
  const [busyCreate, setBusyCreate] = useState(false);

  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.createTitle, title);
  }, [title]);
  useEffect(() => {
    localStorage.setItem(
      ADMIN_DRAFT_KEYS.createCandidates,
      JSON.stringify(candidateInputs)
    );
  }, [candidateInputs]);
  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.createStart, start);
  }, [start]);
  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.createEnd, end);
  }, [end]);
  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.createVoters, voterBlob);
  }, [voterBlob]);
  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.createRelayer, createRelayer);
  }, [createRelayer]);
  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.createSemaphore, createSemaphore);
  }, [createSemaphore]);

  async function deployAndRegister() {
    if (busyCreate || createLockRef.current) return;
    createLockRef.current = true;
    setBusyCreate(true);

    try {
      setCreateMsg(useLocal ? "Connecting Hardhat…" : "Connecting MetaMask…");
      const signer = await getSigner();
      const sp = signer?.provider || provider;
      if (!sp) throw new Error("Provider not ready.");

      const network = await sp.getNetwork();
      const chainId = network.chainId.toString();

      async function registerElectionInRelayer(addressToRegister) {
        try {
          const r = await fetch(`${RELAYER_URL}/elections/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: addressToRegister,
              chainId,
              title,
              startTs,
              endTs,
              source: "admin-deploy",
            }),
          });
          if (!r.ok) {
            const out = await r.json().catch(() => ({}));
            throw new Error(out?.error || "registry save failed");
          }
          return true;
        } catch {
          return false;
        }
      }

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
      const candidates = candidateInputs.map((s) => s.trim()).filter(Boolean);
      const voters = parseAddresses(voterBlob);
      const relayerAddr = createRelayer.trim();

      if (!title || candidates.length < 2)
        throw new Error("Need a title and ≥ 2 candidates");
      if (!(startTs > 0 && endTs > startTs)) throw new Error("Bad time window");
      if (voters.length === 0)
        throw new Error("Provide at least one eligible voter address");
      if (!ethers.isAddress(relayerAddr))
        throw new Error("Provide a valid relayer address.");

      async function registerVotersOrWarn(addr, semaphoreAddrForMsg) {
        const bound = new ethers.Contract(addr, votingArtifact.abi, signer);
        try {
          setCreateMsg(`Registering ${voters.length} voters…`);
          const regTx = await bound.registerVoters(voters);
          setCreateMsg(
            `Registering ${voters.length} voters…\nTx: ${regTx.hash}\nWaiting for confirmation…`
          );
          const regRcpt = await waitForReceiptWithTimeout(regTx, sp, 180_000);
          if (regRcpt && Number(regRcpt.status) === 0) {
            throw new Error("Registration transaction reverted on-chain.");
          }
        } catch (regErr) {
          const msg = regErr?.reason || regErr?.shortMessage || regErr?.message || String(regErr);
          setCreateMsg(
            `⚠️ Contract deployed, but voter registration failed.\nContract: ${addr}\nRelayer: ${relayerAddr}\nSemaphore: ${semaphoreAddrForMsg}\nError: ${msg}`
          );
          return false;
        }
        return true;
      }

      const pending = getPendingDeploy();
      if (pending && pending.chainId === chainId) {
        setCreateMsg(`Checking pending deployment…\nTx: ${pending.hash}`);
        const pendingRcpt = await sp.getTransactionReceipt(pending.hash).catch(() => null);
        if (pendingRcpt?.contractAddress) {
          const recovered = ethers.getAddress(pendingRcpt.contractAddress);
          setDeployedAddr(recovered);
          localStorage.setItem("last_contract", recovered);
          addKnownElectionAddress(recovered);
          clearPendingDeploy();
          const inRegistry = await registerElectionInRelayer(recovered);

          const ok = await registerVotersOrWarn(recovered, createSemaphore.trim() || "unknown");
          if (ok) {
            setCreateMsg(
              `✅ Recovered deployment and registered voters.\nContract: ${recovered}\nRelayer: ${relayerAddr}${inRegistry ? "" : "\n⚠️ Could not save in relayer registry."}`
            );
          }
          return;
        }

        const ageMs = Date.now() - Number(pending.submittedAt || 0);
        if (!pendingRcpt && ageMs < 15 * 60 * 1000) {
          throw new Error(
            `Previous deployment is still pending.\nTx: ${pending.hash}\nWait for confirmation to avoid paying gas twice.`
          );
        }
        clearPendingDeploy();
      }

      let semaphoreAddr = createSemaphore.trim();
      if (semaphoreAddr && !ethers.isAddress(semaphoreAddr)) {
        throw new Error("Semaphore address is invalid.");
      }

      if (semaphoreAddr && (await hasCode(sp, semaphoreAddr))) {
        setCreateMsg("Validating Semaphore contract…");
        const ok = await isSemaphoreContract(sp, semaphoreAddr);
        if (!ok) {
          throw new Error(
            "Semaphore address has code but is not a valid Semaphore contract on this network."
          );
        }
      }

      if (!semaphoreAddr || !(await hasCode(sp, semaphoreAddr))) {
        setCreateMsg("Deploying Poseidon library…");
        const poseidonFactory = new ethers.ContractFactory(
          poseidonArtifact.abi,
          poseidonArtifact.bytecode,
          signer
        );
        const poseidon = await poseidonFactory.deploy();
        const poseidonTx = poseidon.deploymentTransaction();
        setCreateMsg(`Deploying Poseidon library…\nTx: ${poseidonTx.hash}`);
        const poseidonRcpt = await waitForReceiptWithTimeout(poseidonTx, sp, 180_000);
        if (poseidonRcpt && Number(poseidonRcpt.status) === 0) {
          throw new Error("Poseidon deployment reverted on-chain.");
        }
        const poseidonAddr = await poseidon.getAddress();

        setCreateMsg("Deploying Semaphore verifier…");
        const verifierFactory = new ethers.ContractFactory(
          semaphoreVerifierArtifact.abi,
          semaphoreVerifierArtifact.bytecode,
          signer
        );
        const verifier = await verifierFactory.deploy();
        const verifierTx = verifier.deploymentTransaction();
        setCreateMsg(`Deploying Semaphore verifier…\nTx: ${verifierTx.hash}`);
        const verifierRcpt = await waitForReceiptWithTimeout(verifierTx, sp, 180_000);
        if (verifierRcpt && Number(verifierRcpt.status) === 0) {
          throw new Error("Semaphore verifier deployment reverted on-chain.");
        }

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
        const semaphoreTx = semaphore.deploymentTransaction();
        setCreateMsg(`Deploying Semaphore…\nTx: ${semaphoreTx.hash}`);
        const semaphoreRcpt = await waitForReceiptWithTimeout(semaphoreTx, sp, 180_000);
        if (semaphoreRcpt && Number(semaphoreRcpt.status) === 0) {
          throw new Error("Semaphore deployment reverted on-chain.");
        }

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

      const deployTx = contract.deploymentTransaction();
      setPendingDeploy({
        hash: deployTx.hash,
        chainId,
        submittedAt: Date.now(),
      });

      setCreateMsg(`Waiting for election deployment confirmation…\nTx: ${deployTx.hash}`);
      const rcpt = await waitForReceiptWithTimeout(deployTx, sp, 300_000);
      if (rcpt && Number(rcpt.status) === 0) {
        clearPendingDeploy();
        throw new Error("Election deployment transaction reverted on-chain.");
      }
      const addr = rcpt?.contractAddress
        ? ethers.getAddress(rcpt.contractAddress)
        : await contract.getAddress();
      clearPendingDeploy();
      setDeployedAddr(addr);
      localStorage.setItem("last_contract", addr);
      addKnownElectionAddress(addr);
      const inRegistry = await registerElectionInRelayer(addr);

      const ok = await registerVotersOrWarn(addr, semaphoreAddr);
      if (!ok) return;

      setCreateMsg(
        `✅ Deployed & registered.\nContract: ${addr}\nRelayer: ${relayerAddr}\nSemaphore: ${semaphoreAddr}${inRegistry ? "" : "\n⚠️ Could not save in relayer registry."}`
      );
    } catch (e) {
      console.error(e);
      const pending = getPendingDeploy();
      const base = e?.reason || e?.shortMessage || e?.message || String(e);
      const extra = pending?.hash
        ? `\nIf gas was spent, check pending tx:\n${pending.hash}\nDo not redeploy until this tx is confirmed or failed.`
        : "";
      setCreateMsg("❌ " + base + extra);
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
    registeredCount: null,
    you: "",
    title: "",
    startTs: 0,
    endTs: 0,
    status: "",
    groupSize: 0,
  });
  const [busyManage, setBusyManage] = useState(false);
  const [ownedRows, setOwnedRows] = useState([]);
  const [ownedMsg, setOwnedMsg] = useState("");
  const [ownedBusy, setOwnedBusy] = useState(false);
  const [ownedYou, setOwnedYou] = useState("");
  const [ownedChainId, setOwnedChainId] = useState("");

  const [newStart, setNewStart] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.manageNewStart) || ""
  );
  const [newEnd, setNewEnd] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.manageNewEnd) || ""
  );
  const [moreVotersBlob, setMoreVotersBlob] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.manageMoreVoters) || ""
  );
  const [manageVoterImportMsg, setManageVoterImportMsg] = useState("");
  const [newRelayer, setNewRelayer] = useState(
    () => localStorage.getItem(ADMIN_DRAFT_KEYS.manageNewRelayer) || ""
  );
  const [relayerMsg, setRelayerMsg] = useState("");
  const [windowMsg, setWindowMsg] = useState("");
  const [registerMsg, setRegisterMsg] = useState("");
  const [emergencyMsg, setEmergencyMsg] = useState("");

  function clearActionMsgs() {
    setRelayerMsg("");
    setWindowMsg("");
    setRegisterMsg("");
    setEmergencyMsg("");
  }

  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.manageNewStart, newStart);
  }, [newStart]);
  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.manageNewEnd, newEnd);
  }, [newEnd]);
  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.manageMoreVoters, moreVotersBlob);
  }, [moreVotersBlob]);
  useEffect(() => {
    localStorage.setItem(ADMIN_DRAFT_KEYS.manageNewRelayer, newRelayer);
  }, [newRelayer]);

  const candidateCsv = useMemo(
    () => candidateInputs.map((c) => c.trim()).filter(Boolean).join(", "),
    [candidateInputs]
  );

  function updateCandidateAt(index, value) {
    setCandidateInputs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function addCandidateField() {
    setCandidateInputs((prev) => [...prev, ""]);
  }

  function removeCandidateField(index) {
    setCandidateInputs((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  function clearCreateForm() {
    setTitle("");
    setCandidateInputs(["", ""]);
    setStart("");
    setEnd("");
    setVoterBlob("");
    setCreateRelayer(DEFAULT_RELAYER);
    setCreateSemaphore("");
    setCreateVoterImportMsg("");
    setCreateMsg("Form cleared.");
    setDeployedAddr("");
  }

  async function importCreateVotersCsv(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseAddresses(text);
      if (imported.length === 0) {
        throw new Error("No valid voter addresses found in CSV.");
      }
      const merged = mergeAddressLists(parseAddresses(voterBlob), imported);
      setVoterBlob(merged.join("\n"));
      setCreateVoterImportMsg(`Imported ${imported.length} address(es) from ${file.name}.`);
    } catch (e) {
      setCreateVoterImportMsg(`Import failed: ${e?.message || String(e)}`);
    }
  }

  async function importManageVotersCsv(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseAddresses(text);
      if (imported.length === 0) {
        throw new Error("No valid voter addresses found in CSV.");
      }
      const merged = mergeAddressLists(parseAddresses(moreVotersBlob), imported);
      setMoreVotersBlob(merged.join("\n"));
      setManageVoterImportMsg(`Imported ${imported.length} address(es) from ${file.name}.`);
    } catch (e) {
      setManageVoterImportMsg(`Import failed: ${e?.message || String(e)}`);
    }
  }

  async function loadOwnedElections() {
    if (ownedBusy) return;
    setOwnedBusy(true);
    setOwnedMsg("");

    try {
      if (!provider) throw new Error("Provider not ready.");
      setOwnedMsg("Connecting signer…");
      const signer = await getSigner();
      const you = ethers.getAddress(await signer.getAddress());
      setOwnedYou(you);

      const net = await provider.getNetwork();
      const chainId = net.chainId.toString();
      setOwnedChainId(chainId);

      setOwnedMsg("Loading election list from relayer registry…");
      let page = 1;
      let totalPages = 1;
      const byAddress = new Map();

      while (page <= totalPages) {
        const loaded = await loadElectionEntriesFromRelayer(
          chainId,
          page,
          MY_ELECTIONS_PAGE_SIZE
        );
        totalPages = Math.max(1, loaded.totalPages);
        for (const entry of loaded.entries) {
          byAddress.set(entry.address, entry);
        }
        page += 1;
      }

      const discovered = Array.from(byAddress.values());
      if (discovered.length === 0) {
        setOwnedRows([]);
        setOwnedMsg(`No elections found in relayer registry for chain ${chainId}.`);
        return;
      }

      setOwnedMsg(`Checking ownership on ${discovered.length} election(s)…`);
      const ownerLower = you.toLowerCase();
      const candidates = [];

      for (const entry of discovered) {
        try {
          const c = new ethers.Contract(entry.address, MGMT_ABI, provider);
          const admin = ethers.getAddress(await c.admin());
          if (admin.toLowerCase() !== ownerLower) continue;

          let status = "UNKNOWN";
          let titleOut = entry.title || "";
          let startOut = Number(entry.startTs) || 0;
          let endOut = Number(entry.endTs) || 0;
          let loadError = "";

          try {
            const [statusRaw, info] = await Promise.all([c.status(), c.electionInfo()]);
            status = statusRaw || "UNKNOWN";
            titleOut = info?.[0] || titleOut;
            startOut = Number(info?.[1]) || startOut;
            endOut = Number(info?.[2]) || endOut;
          } catch (e) {
            loadError = e?.message || String(e);
          }

          candidates.push({
            address: entry.address,
            admin,
            title: titleOut,
            startTs: startOut,
            endTs: endOut,
            status,
            error: loadError,
          });
        } catch {
          // ignore addresses that are not compatible with current ABI
        }
      }

      candidates.sort((a, b) => {
        const aKey = Number(a.endTs || a.startTs || 0);
        const bKey = Number(b.endTs || b.startTs || 0);
        return bKey - aKey;
      });

      setOwnedRows(candidates);
      setOwnedMsg(
        `Found ${candidates.length} election(s) owned by ${you} on chain ${chainId}.`
      );
    } catch (e) {
      console.error(e);
      setOwnedRows([]);
      setOwnedMsg("❌ " + errMsg(e));
    } finally {
      setOwnedBusy(false);
    }
  }

  const isAdmin = useMemo(() => {
    return (
      mgmt.admin &&
      mgmt.you &&
      mgmt.admin.toLowerCase() === mgmt.you.toLowerCase()
    );
  }, [mgmt.admin, mgmt.you]);

  const nowSec = Math.floor(Date.now() / 1000);
  const hasStarted = mgmt.startTs ? nowSec >= mgmt.startTs : false;

  async function attach(targetAddress = attachAddr) {
    if (busyManage) return;
    setBusyManage(true);

    try {
      clearActionMsgs();
      setMgmtMsg("Checking address…");
      const normalizedTarget = firstAddress(String(targetAddress || "").trim());
      if (!normalizedTarget)
        throw new Error("Enter a valid contract address.");
      if (!provider) throw new Error("Provider not ready.");
      setAttachAddr(normalizedTarget);

      const ok = await hasCode(provider, normalizedTarget);
      if (!ok)
        throw new Error("No contract code at this address on current RPC.");

      const c = new ethers.Contract(normalizedTarget, MGMT_ABI, provider);

      setMgmtMsg("Loading election info…");
      const admin = await c.admin();
      const relayer = await c.relayer();
      const semaphore = await c.semaphore();
      const [nm, sTs, eTs] = await c.electionInfo();
      const st = await c.status();
      const groupSize = Number(await c.groupSize());
      const registeredCount = await fetchRegisteredVoterCount(c);

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
        registeredCount,
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
      addKnownElectionAddress(normalizedTarget);
      try {
        const chain = await provider.getNetwork();
        await fetch(`${RELAYER_URL}/elections/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: normalizedTarget,
            chainId: Number(chain.chainId),
            title: nm,
            startTs: sNum,
            endTs: eNum,
            source: "admin-attach",
          }),
        });
      } catch {
        // best-effort: attach should still succeed even if registry is unavailable
      }

      setMgmtMsg(
        typeof registeredCount === "number"
          ? "✅ Attached."
          : "✅ Attached. ⚠️ Registered voter count unavailable on current RPC."
      );
    } catch (e) {
      console.error(e);
      setMgmtMsg("❌ " + (e?.message || String(e)));
      clearActionMsgs();
      setMgmt({
        contract: null,
        admin: "",
        relayer: "",
        semaphore: "",
        registeredCount: null,
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

      setEmergencyMsg("Connecting signer…");
      const signer = await getSigner();
      const write = mgmt.contract.connect(signer);
      const your = await signer.getAddress();

      if (mgmt.admin && your.toLowerCase() !== mgmt.admin.toLowerCase()) {
        throw new Error(`You are not the admin. Admin is ${mgmt.admin}`);
      }

      setEmergencyMsg("Ending election…");
      const tx = await write.closeEarly();
      setEmergencyMsg(`Waiting for confirmation… (tx: ${tx.hash})`);
      const txProvider = signer?.provider || provider;
      await waitForReceiptWithTimeout(tx, txProvider, 180_000);

      const [, sTs, eTs] = await mgmt.contract.electionInfo();
      const st = await mgmt.contract.status();

      const sNum = Number(sTs);
      const eNum = Number(eTs);

      setMgmt((m) => ({ ...m, startTs: sNum, endTs: eNum, status: st, you: your }));
      setNewStart(toLocalInputValue(sNum));
      setNewEnd(toLocalInputValue(eNum));

      setEmergencyMsg("✅ Election ended (closeEarly confirmed).");
    } catch (e) {
      console.error(e);
      setEmergencyMsg("❌ " + errMsg(e));
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

      setWindowMsg("Connecting signer…");
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

      setWindowMsg("Updating election window…");
      const tx = await write.updateWindow(BigInt(s), BigInt(e));
      setWindowMsg(`Waiting for confirmation… (tx: ${tx.hash})`);
      const txProvider = signer?.provider || provider;
      await waitForReceiptWithTimeout(tx, txProvider, 180_000);

      const [, sTs, eTs] = await mgmt.contract.electionInfo();
      const st = await mgmt.contract.status();
      const sNum = Number(sTs);
      const eNum = Number(eTs);

      setMgmt((m) => ({ ...m, startTs: sNum, endTs: eNum, status: st, you: your }));
      setNewStart(toLocalInputValue(sNum));
      setNewEnd(toLocalInputValue(eNum));

      setWindowMsg("✅ Election window updated.");
    } catch (e) {
      console.error(e);
      setWindowMsg("❌ " + errMsg(e));
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

      setRegisterMsg("Connecting signer…");
      const signer = await getSigner();
      const write = mgmt.contract.connect(signer);
      const your = await signer.getAddress();

      if (mgmt.admin && your.toLowerCase() !== mgmt.admin.toLowerCase()) {
        throw new Error(`You are not the admin. Admin is ${mgmt.admin}`);
      }

      const BATCH = 200;
      setRegisterMsg(`Registering ${addrs.length} voters…`);

      for (let i = 0; i < addrs.length; i += BATCH) {
        const chunk = addrs.slice(i, i + BATCH);
        const tx = await write.registerVoters(chunk);
        setRegisterMsg(
          `Registering ${addrs.length} voters… (batch ${
            Math.floor(i / BATCH) + 1
          }/${Math.ceil(addrs.length / BATCH)})`
        );
        const txProvider = signer?.provider || provider;
        await waitForReceiptWithTimeout(tx, txProvider, 180_000);
      }

      setMoreVotersBlob("");
      const st = await mgmt.contract.status();
      const registeredCount = await fetchRegisteredVoterCount(mgmt.contract);
      setMgmt((m) => ({
        ...m,
        status: st,
        you: your,
        registeredCount:
          typeof registeredCount === "number" ? registeredCount : m.registeredCount,
      }));

      setRegisterMsg(`✅ Registered ${addrs.length} additional voters.`);
    } catch (e) {
      console.error(e);
      setRegisterMsg("❌ " + errMsg(e));
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
      setRelayerMsg(`Updating relayer… (tx: ${tx.hash})`);
      const txProvider = signer?.provider || provider;
      await waitForReceiptWithTimeout(tx, txProvider, 180_000);

      setMgmt((m) => ({ ...m, relayer: ethers.getAddress(newRelayer), you: your }));
      setRelayerMsg("✅ Relayer updated.");
    } catch (e) {
      console.error(e);
      setRelayerMsg("❌ " + errMsg(e));
    } finally {
      setBusyManage(false);
    }
  }

  return (
    <div className="page" data-testid="admin-page">
      <div className="admin-head-row">
        <h1>Admin</h1>
        <div className="admin-mode-inline">
          <span className="admin-mode-chip">
            {useLocal ? "Local signer" : "MetaMask signer"}
          </span>
          <label className="admin-switch admin-switch-compact" title="Toggle signer mode">
            <input
              type="checkbox"
              className="admin-switch-input"
              data-testid="admin-use-local-toggle"
              checked={useLocal}
              onChange={(e) => setUseLocal(e.target.checked)}
            />
            <span className="admin-switch-track" aria-hidden="true">
              <span className="admin-switch-thumb" />
            </span>
          </label>
        </div>
      </div>

      {useLocal && (
        <section className="card admin-local-key-card" data-testid="admin-auth-card">
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
        </section>
      )}

      <div className="admin-tabs" data-testid="admin-tabs">
        <button
          className={`admin-tab ${tab === "create" ? "admin-tab-active" : ""}`}
          data-testid="tab-create"
          onClick={() => setTab("create")}
          aria-pressed={tab === "create"}
          type="button"
        >
          Create Election
        </button>
        <button
          className={`admin-tab ${tab === "manage" ? "admin-tab-active" : ""}`}
          data-testid="tab-manage"
          onClick={() => setTab("manage")}
          aria-pressed={tab === "manage"}
          type="button"
        >
          Manage Existing
        </button>
        <button
          className={`admin-tab ${tab === "mine" ? "admin-tab-active" : ""}`}
          data-testid="tab-mine"
          onClick={() => setTab("mine")}
          aria-pressed={tab === "mine"}
          type="button"
        >
          My Elections
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

          <div className="field">
            <span>Candidates</span>
            <div className="admin-candidate-list" data-testid="create-candidate-list">
              {candidateInputs.map((cand, index) => (
                <div className="admin-candidate-row" key={`candidate-${index}`}>
                  <input
                    className="input"
                    data-testid={`create-candidate-${index}`}
                    value={cand}
                    onChange={(e) => updateCandidateAt(index, e.target.value)}
                    placeholder={`Candidate ${index + 1}`}
                  />
                  <button
                    type="button"
                    className="btn admin-candidate-remove"
                    onClick={() => removeCandidateField(index)}
                    disabled={candidateInputs.length <= 2}
                    title={candidateInputs.length <= 2 ? "At least 2 candidates required" : ""}
                  >
                    <span className="btn-icon"><UiIcon name="clear" /></span>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="actions">
              <button type="button" className="btn" onClick={addCandidateField}>
                <span className="btn-icon"><UiIcon name="plus" /></span>
                Add Candidate
              </button>
            </div>
            <div className="hint">At least 2 candidate names are required.</div>
            <input type="hidden" data-testid="create-candidates" value={candidateCsv} readOnly />
          </div>

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
              className="input mono admin-address-textarea"
              data-testid="create-voters"
              value={voterBlob}
              onChange={(e) => {
                setVoterBlob(e.target.value);
                setCreateVoterImportMsg("");
              }}
              placeholder={`Paste lines like:\nAccount #1: 0x...\nAccount #2: 0x...`}
            />
          </label>
          <div className="admin-inline-actions">
            <label className="btn admin-file-btn" htmlFor="create-voters-csv">
              <span className="btn-icon"><UiIcon name="upload" /></span>
              Import CSV
            </label>
            <input
              id="create-voters-csv"
              data-testid="create-voters-csv"
              className="admin-file-input"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                await importCreateVotersCsv(file);
                e.target.value = "";
              }}
            />
            <span className="hint">Detected voters: {parseAddresses(voterBlob).length}</span>
          </div>
          {createVoterImportMsg && <div className="hint">{createVoterImportMsg}</div>}

          <div className="actions actions-mobile-grid">
            <button
              className="btn"
              data-testid="create-deploy-register"
              onClick={deployAndRegister}
              disabled={busyCreate}
            >
              <span className={`btn-icon ${busyCreate ? "is-spinning" : ""}`}>
                <UiIcon name={busyCreate ? "refresh" : "deploy"} />
              </span>
              {busyCreate ? "Working…" : "Deploy & Register"}
            </button>
            <button
              type="button"
              className="btn"
              data-testid="create-clear"
              onClick={clearCreateForm}
              disabled={busyCreate}
            >
              <span className="btn-icon"><UiIcon name="clear" /></span>
              Clear
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
      ) : tab === "manage" ? (
        <section className="card" data-testid="manage-existing-card">
          <h2>Manage Existing</h2>

          <div className="admin-attach-row">
            <label className="field">
              <span>Contract Address</span>
              <input
                className="input mono"
                data-testid="manage-contract-address"
                value={attachAddr}
                onChange={(e) => setAttachAddr(e.target.value)}
                placeholder="0x…"
              />
            </label>

            <div className="actions admin-attach-actions">
              <button
                className="btn"
                data-testid="manage-attach"
                onClick={() => attach()}
                disabled={busyManage}
              >
                <span className={`btn-icon ${busyManage ? "is-spinning" : ""}`}>
                  <UiIcon name={busyManage ? "refresh" : "attach"} />
                </span>
                {busyManage ? "Attaching…" : "Attach"}
              </button>
            </div>
          </div>

          <div className="hint pre" data-testid="manage-message">
            {mgmtMsg}
          </div>

          {mgmt.contract && (
            <div className="admin-manage-shell" data-testid="manage-details">
              <div className="admin-metrics-grid">
                <div className="admin-metric">
                  <div className="admin-metric-label">Title</div>
                  <div>{mgmt.title || "—"}</div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">Status</div>
                  <div>
                    <span
                      className={`home-status home-status-${
                        mgmt.status?.toLowerCase() === "open" ||
                        mgmt.status?.toLowerCase() === "pending" ||
                        mgmt.status?.toLowerCase() === "closed"
                          ? mgmt.status.toLowerCase()
                          : "unknown"
                      }`}
                    >
                      {mgmt.status || "UNKNOWN"}
                    </span>
                  </div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">Admin</div>
                  <div className="mono">{mgmt.admin}</div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">You</div>
                  <div className="mono">{mgmt.you || "—"}</div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">Relayer</div>
                  <div className="mono">{mgmt.relayer || "—"}</div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">Semaphore</div>
                  <div className="mono">{mgmt.semaphore || "—"}</div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">Start</div>
                  <div>{fmtTs(mgmt.startTs)}</div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">End</div>
                  <div>{fmtTs(mgmt.endTs)}</div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">Registered Voters</div>
                  <div>
                    {typeof mgmt.registeredCount === "number" ? mgmt.registeredCount : "—"}
                  </div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">Linked Identities</div>
                  <div>{mgmt.groupSize}</div>
                </div>
                <div className="admin-metric">
                  <div className="admin-metric-label">Permissions</div>
                  <div>{isAdmin ? "Admin access" : "Read-only (not admin)"}</div>
                </div>
              </div>

              <div className="admin-action-grid">
                <section className="admin-subcard">
                  <h3>Update Relayer</h3>
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
                  <div className="actions">
                    <button
                      className="btn"
                      onClick={updateRelayer}
                      disabled={!isAdmin || busyManage}
                    >
                      <span className={`btn-icon ${busyManage ? "is-spinning" : ""}`}>
                        <UiIcon name={busyManage ? "refresh" : "settings"} />
                      </span>
                      Update Relayer
                    </button>
                  </div>
                  {relayerMsg && <div className="hint pre admin-action-msg">{relayerMsg}</div>}
                </section>

                <section className="admin-subcard admin-subcard-window">
                  <h3>Update Window (before start)</h3>
                  <div className="grid2">
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
                  <div className="actions">
                    <button
                      className="btn"
                      data-testid="manage-update-window"
                      onClick={updateElectionWindow}
                      disabled={!isAdmin || busyManage || hasStarted}
                    >
                      <span className={`btn-icon ${busyManage ? "is-spinning" : ""}`}>
                        <UiIcon name={busyManage ? "refresh" : "settings"} />
                      </span>
                      Update Window
                    </button>
                  </div>
                  {windowMsg && <div className="hint pre admin-action-msg">{windowMsg}</div>}
                </section>

                <section className="admin-subcard">
                  <h3>Register More Voters (before start)</h3>
                  <label className="field">
                    <span>Additional Voter Addresses</span>
                    <textarea
                      className="input mono admin-address-textarea"
                      data-testid="manage-more-voters"
                      value={moreVotersBlob}
                      onChange={(e) => {
                        setMoreVotersBlob(e.target.value);
                        setManageVoterImportMsg("");
                      }}
                      placeholder={`Paste addresses here:\n0xabc...\n0xdef...`}
                      disabled={!isAdmin || busyManage || hasStarted}
                    />
                  </label>
                  <div className="admin-inline-actions">
                    <label className="btn admin-file-btn" htmlFor="manage-voters-csv">
                      <span className="btn-icon"><UiIcon name="upload" /></span>
                      Import CSV
                    </label>
                    <input
                      id="manage-voters-csv"
                      className="admin-file-input"
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      disabled={!isAdmin || busyManage || hasStarted}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        await importManageVotersCsv(file);
                        e.target.value = "";
                      }}
                    />
                    <span className="hint">Detected voters: {parseAddresses(moreVotersBlob).length}</span>
                  </div>
                  {manageVoterImportMsg && <div className="hint">{manageVoterImportMsg}</div>}
                  <div className="actions">
                    <button
                      className="btn"
                      data-testid="manage-register-more"
                      onClick={registerMoreVoters}
                      disabled={!isAdmin || busyManage || hasStarted}
                    >
                      <span className={`btn-icon ${busyManage ? "is-spinning" : ""}`}>
                        <UiIcon name={busyManage ? "refresh" : "users"} />
                      </span>
                      Register More Voters
                    </button>
                  </div>
                  {registerMsg && <div className="hint pre admin-action-msg">{registerMsg}</div>}
                </section>

                <section className="admin-subcard admin-subcard-danger">
                  <h3>Emergency</h3>
                  <p className="hint">Close the election immediately. This cannot be undone.</p>
                  <div className="actions">
                    <button
                      className="btn"
                      data-testid="manage-end-now"
                      onClick={endElectionNow}
                      disabled={!isAdmin || busyManage}
                    >
                      <span className={`btn-icon ${busyManage ? "is-spinning" : ""}`}>
                        <UiIcon name={busyManage ? "refresh" : "danger"} />
                      </span>
                      {busyManage ? "Working…" : "End Election Now"}
                    </button>
                  </div>
                  {emergencyMsg && <div className="hint pre admin-action-msg">{emergencyMsg}</div>}
                </section>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="card" data-testid="my-elections-card">
          <h2>My Elections</h2>
          <p className="hint">
            Loads election addresses from the relayer registry (max 50 recent on this chain), then
            filters by on-chain <span className="mono">admin()</span> matching your signer.
          </p>

          <div className="actions">
            <button
              className="btn"
              type="button"
              data-testid="mine-load"
              onClick={loadOwnedElections}
              disabled={ownedBusy}
            >
              <span className={`btn-icon ${ownedBusy ? "is-spinning" : ""}`}>
                <UiIcon name={ownedBusy ? "refresh" : "load"} />
              </span>
              {ownedBusy ? "Loading…" : "Load My Elections"}
            </button>
            <span className="hint">
              Chain: {ownedChainId || "—"} | Wallet:{" "}
              <span className="mono">{ownedYou || "—"}</span>
            </span>
          </div>

          <div className="hint pre" data-testid="mine-message">
            {ownedMsg}
          </div>

          {ownedRows.length > 0 ? (
            <div className="admin-owned-wrap">
              <table className="table admin-owned-table" data-testid="mine-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ownedRows.map((row) => (
                    <tr key={row.address}>
                      <td className="admin-owned-title-cell">
                        <div>{row.title || "—"}</div>
                        <div className="mono admin-owned-address">{row.address}</div>
                        {row.error && <div className="hint">{row.error}</div>}
                      </td>
                      <td>
                        <span
                          className={`home-status home-status-${
                            row.status?.toLowerCase() === "open" ||
                            row.status?.toLowerCase() === "pending" ||
                            row.status?.toLowerCase() === "closed"
                              ? row.status.toLowerCase()
                              : "unknown"
                          }`}
                        >
                          {row.status || "UNKNOWN"}
                        </span>
                      </td>
                      <td>{fmtTs(row.startTs)}</td>
                      <td>{fmtTs(row.endTs)}</td>
                      <td>
                        <div className="admin-owned-actions">
                          <button
                            className="btn"
                            type="button"
                            onClick={() => {
                              localStorage.setItem("last_contract", row.address);
                              navigate(`/election/${row.address}`);
                            }}
                          >
                            <span className="btn-icon"><UiIcon name="switch" /></span>
                            Open
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => {
                              setTab("manage");
                              void attach(row.address);
                            }}
                          >
                            <span className="btn-icon"><UiIcon name="settings" /></span>
                            Manage
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="hint">No owned elections loaded yet.</div>
          )}
        </section>
      )}
    </div>
  );
}
