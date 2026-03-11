import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ethers } from "ethers";
import { Identity } from "@semaphore-protocol/identity";

import votingArtifact from "../Voting.json";
import UiIcon from "../components/UiIcon";
import { addKnownElectionAddress } from "../lib/electionStore";

const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:8787";

function normErr(e) {
  return e?.reason || e?.shortMessage || e?.message || String(e);
}

function fmt(tsSec) {
  if (!tsSec) return "—";
  return new Date(Number(tsSec) * 1000).toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function LinkIdentityPage() {
  const { addr } = useParams();
  const navigate = useNavigate();

  const [provider, setProvider] = useState(null);
  const [contract, setContract] = useState(null);

  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [startTs, setStartTs] = useState(0);
  const [endTs, setEndTs] = useState(0);

  const [useLocal, setUseLocal] = useState(
    () => localStorage.getItem("vote.useLocal") === "1"
  );
  const [pk, setPk] = useState(() => localStorage.getItem("vote.pk") || "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem("vote.useLocal", useLocal ? "1" : "0");
  }, [useLocal]);

  useEffect(() => {
    if (pk?.startsWith("0x")) localStorage.setItem("vote.pk", pk);
  }, [pk]);

  useEffect(() => {
    if (!ethers.isAddress(addr)) {
      navigate("/", { replace: true });
      return;
    }
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, [addr, navigate]);

  useEffect(() => {
    if (!provider || !ethers.isAddress(addr)) return;
    setContract(new ethers.Contract(addr, votingArtifact.abi, provider));
  }, [provider, addr]);

  async function load() {
    if (!contract) return;
    try {
      const [st, info] = await Promise.all([contract.status(), contract.electionInfo()]);
      setStatus(st);
      setTitle(info?.[0] || "");
      setStartTs(Number(info?.[1] || 0));
      setEndTs(Number(info?.[2] || 0));
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (!contract) return;
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);

  const canLinkNow = useMemo(() => status === "PENDING", [status]);

  async function getLocalWallet() {
    if (!pk || !pk.startsWith("0x")) {
      throw new Error("Enter a private key (0x…) for local mode.");
    }
    if (!provider) throw new Error("Provider not ready.");
    return new ethers.Wallet(pk, provider);
  }

  async function getMetaMaskSigner() {
    if (!window.ethereum) throw new Error("MetaMask not found");
    const bp = new ethers.BrowserProvider(window.ethereum);
    await bp.send("eth_requestAccounts", []);
    return bp.getSigner();
  }

  async function getSignerAndAddress() {
    if (useLocal) {
      const signer = await getLocalWallet();
      return { signer, voterAddr: await signer.getAddress() };
    }
    const signer = await getMetaMaskSigner();
    return { signer, voterAddr: await signer.getAddress() };
  }

  async function deriveIdentity(signer, voterAddr) {
    const identitySeedMsg = `E-Voting ZK Identity\nContract:${addr}\nVoter:${voterAddr}`;
    const sig = await signer.signMessage(identitySeedMsg);
    return new Identity(sig);
  }

  async function checkLinkStatus() {
    if (busy) return;
    setBusy(true);
    try {
      if (!contract) throw new Error("Contract not ready.");
      setMsg("Checking identity link state…");

      const { signer, voterAddr } = await getSignerAndAddress();
      const [isRegisteredRaw, linkedRaw] = await Promise.all([
        contract.registered(voterAddr),
        contract.linkedIdentityCommitment(voterAddr),
      ]);
      if (!isRegisteredRaw) {
        throw new Error("This wallet is not on the election allowlist.");
      }

      const identity = await deriveIdentity(signer, voterAddr);
      const linked = BigInt(linkedRaw.toString());
      const mine = BigInt(identity.commitment.toString());

      if (linked === 0n) {
        setMsg("Identity is not linked yet for this wallet.");
        return;
      }

      if (linked !== mine) {
        throw new Error(
          "Wallet is linked to a different local identity. Use the original browser/profile used for first identity setup."
        );
      }

      setMsg("✅ Identity is already linked and ready for voting.");
    } catch (e) {
      console.error(e);
      setMsg("❌ " + normErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function linkIdentityNow() {
    if (busy) return;
    setBusy(true);
    try {
      if (!contract) throw new Error("Contract not ready.");
      if (!canLinkNow) {
        throw new Error("Linking is only allowed while election status is PENDING.");
      }

      setMsg("Preparing wallet and identity…");
      const { signer, voterAddr } = await getSignerAndAddress();
      const isRegisteredRaw = await contract.registered(voterAddr);
      if (!isRegisteredRaw) {
        throw new Error("This wallet is not on the election allowlist.");
      }

      const identity = await deriveIdentity(signer, voterAddr);
      const linkedRaw = await contract.linkedIdentityCommitment(voterAddr);
      const linked = BigInt(linkedRaw.toString());
      const mine = BigInt(identity.commitment.toString());

      if (linked === mine) {
        setMsg("✅ Identity is already linked and ready.");
        return;
      }
      if (linked !== 0n) {
        throw new Error(
          "Wallet is linked to a different local identity. Use the original browser/profile used for first identity setup."
        );
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const expirySec = Math.min(Math.max(0, Number(startTs) - 1), nowSec + 10 * 60);
      if (expirySec <= nowSec) {
        throw new Error("Election start is too close. Cannot create a valid link expiry.");
      }

      const expiry = BigInt(expirySec);
      const payloadHash = await contract.linkPayloadHash(voterAddr, mine, expiry);
      const signature = await signer.signMessage(ethers.getBytes(payloadHash));

      setMsg("Submitting identity link via relayer…");
      const r = await fetch(`${RELAYER_URL}/zk-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          votingAddress: addr,
          voter: voterAddr,
          identityCommitment: mine.toString(),
          expiry: expiry.toString(),
          signature,
        }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out?.error || "Relayer link error");

      addKnownElectionAddress(addr);
      setMsg(`✅ Identity linked.\nTx:\n${out.txHash || "unknown"}`);
      await load();
    } catch (e) {
      console.error(e);
      setMsg("❌ " + normErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page vote-page link-page">
      <div className="vote-head-row">
        <h1>Link Identity</h1>
        <div className="vote-mode-inline">
          <span className="vote-mode-chip">{useLocal ? "Local signer" : "MetaMask signer"}</span>
          <label className="admin-switch admin-switch-compact" title="Toggle signer mode">
            <input
              type="checkbox"
              className="admin-switch-input"
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
        <section className="card vote-local-key-card">
          <p className="hint">Dev mode only. Avoid using real private keys in browser input.</p>
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
        </section>
      )}

      <section className="card vote-info-card">
        <div className="kv">
          <b>Contract:</b> <span className="mono">{addr}</span>
        </div>
        <div className="kv">
          <b>Status:</b>{" "}
          <span
            className={`home-status home-status-${
              status?.toLowerCase() === "open" ||
              status?.toLowerCase() === "pending" ||
              status?.toLowerCase() === "closed"
                ? status.toLowerCase()
                : "unknown"
            }`}
          >
            {status || "UNKNOWN"}
          </span>
        </div>
        <div className="kv">
          <b>Title:</b> {title || "—"}
        </div>
        <div className="kv">
          <b>Starts:</b> {fmt(startTs)}
        </div>
        <div className="kv">
          <b>Ends:</b> {fmt(endTs)}
        </div>
        <div className="actions actions-mobile-grid">
          <Link className="btn link" to={`/election/${addr}`}>
            <span className="btn-icon"><UiIcon name="back" /></span>
            Back to Election
          </Link>
          <Link className="btn link" to={`/election/${addr}/vote`}>
            <span className="btn-icon"><UiIcon name="vote" /></span>
            Cast Ballot
          </Link>
        </div>
      </section>

      <section className="card link-step-card">
        <h2>Pre-Election Identity Setup</h2>
        <p className="hint">
          This one-time step links your private Semaphore identity to the election group. Linking
          is only available while status is <b>PENDING</b>.
        </p>

        <div className="link-step-grid">
          <div className="link-step">
            <div className="link-step-num">1</div>
            <div>Connect wallet/signer and verify your wallet is registered.</div>
          </div>
          <div className="link-step">
            <div className="link-step-num">2</div>
            <div>Sign identity setup payload and submit via relayer (gasless).</div>
          </div>
          <div className="link-step">
            <div className="link-step-num">3</div>
            <div>After OPEN starts, go to Cast Ballot. No linking is allowed during voting.</div>
          </div>
        </div>

        <div className="actions actions-mobile-grid">
          <button className="btn" type="button" disabled={busy} onClick={checkLinkStatus}>
            <span className={`btn-icon ${busy ? "is-spinning" : ""}`}>
              <UiIcon name={busy ? "refresh" : "search"} />
            </span>
            {busy ? "Working…" : "Check My Link Status"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || !canLinkNow}
            onClick={linkIdentityNow}
          >
            <span className={`btn-icon ${busy ? "is-spinning" : ""}`}>
              <UiIcon name={busy ? "refresh" : "link"} />
            </span>
            {busy ? "Working…" : canLinkNow ? "Link Identity Now" : "Linking Closed"}
          </button>
          {!canLinkNow && (
            <span className="hint">Wait for next election setup if you missed pending phase.</span>
          )}
        </div>

        <pre className="hint pre vote-msg-box">{msg || "Ready."}</pre>
      </section>
    </div>
  );
}
