// src/pages/VotePage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ethers } from "ethers";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";

import votingArtifact from "../Voting.json";
import UiIcon from "../components/UiIcon";
import { addKnownElectionAddress, markVotedLocally } from "../lib/electionStore";
import { friendlyUiError } from "../lib/errors";
import { isKioskMode } from "../lib/uiMode";

const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:8787";

function normErr(e) {
  return friendlyUiError(e);
}

export default function VotePage() {
  const { addr } = useParams();
  const navigate = useNavigate();

  const [provider, setProvider] = useState(null);
  const [contract, setContract] = useState(null);

  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [startTs, setStartTs] = useState(0);
  const [endTs, setEndTs] = useState(0);
  const [candidates, setCandidates] = useState([]);
  const [optionIndex, setOptionIndex] = useState(0);

  const [useLocal, setUseLocal] = useState(
    () => localStorage.getItem("vote.useLocal") === "1"
  );
  const [pk, setPk] = useState(() => localStorage.getItem("vote.pk") || "");
  const [voteMsg, setVoteMsg] = useState("");
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
      const [st, cs, info] = await Promise.all([
        contract.status(),
        contract.candidates(),
        contract.electionInfo(),
      ]);
      setStatus(st);
      setCandidates(cs);
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

  const canVote = useMemo(() => status === "OPEN", [status]);

  function fmt(tsSec) {
    if (!tsSec) return "—";
    return new Date(Number(tsSec) * 1000).toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

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
    const signer = await bp.getSigner();
    return { bp, signer };
  }

  async function getSigner() {
    if (useLocal) {
      const signer = await getLocalWallet();
      return { signer, address: await signer.getAddress() };
    }

    const { signer } = await getMetaMaskSigner();
    return { signer, address: await signer.getAddress() };
  }

  async function deriveIdentity(signer, voterAddr) {
    const msg = `E-Voting ZK Identity\nContract:${addr}\nVoter:${voterAddr}`;
    const sig = await signer.signMessage(msg);
    return new Identity(sig);
  }

  async function ensureIdentityReadyForVote(voterAddr, identity) {
    if (!contract) throw new Error("Contract not ready.");

    const linked = await contract.linkedIdentityCommitment(voterAddr);
    const linkedCommitment = BigInt(linked.toString());
    const myCommitment = BigInt(identity.commitment.toString());

    if (linkedCommitment === 0n) {
      throw new Error(
        "Identity is not linked for this election. Complete Link Identity during PENDING status first."
      );
    }

    if (linkedCommitment !== myCommitment) {
      throw new Error(
        "This wallet is already linked to a different private identity on this election. Use the original browser/profile used for first identity setup."
      );
    }
  }

  async function buildGroupFromChain() {
    if (!contract) throw new Error("Contract not ready.");

    const logs = await contract.queryFilter(contract.filters.IdentityLinked(), 0, "latest");
    const members = logs.map((log) => BigInt(log.args.identityCommitment.toString()));

    if (members.length === 0) {
      throw new Error("No linked identities found yet.");
    }

    return new Group(members);
  }

  async function castVote() {
    if (!canVote || busy) return;

    setBusy(true);
    try {
      if (!contract) throw new Error("Contract not ready.");

      setVoteMsg("Connecting signer…");
      const { signer, address: voterAddr } = await getSigner();

      setVoteMsg("Preparing private identity…");
      const identity = await deriveIdentity(signer, voterAddr);

      await ensureIdentityReadyForVote(voterAddr, identity);

      setVoteMsg("Building group state…");
      const group = await buildGroupFromChain();
      if (group.indexOf(identity.commitment) === -1) {
        throw new Error("Linked identity not found in group. Please retry in a few seconds.");
      }

      const receipt = ethers.hexlify(ethers.randomBytes(32));
      const message = await contract.voteMessage(Number(optionIndex), receipt);
      const scope = await contract.voteScope();

      setVoteMsg("Generating zero-knowledge proof…");
      const proof = await generateProof(identity, group, message, scope);

      setVoteMsg("Submitting vote via relayer (gasless)…");
      const r = await fetch(`${RELAYER_URL}/zk-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          votingAddress: addr,
          optionIndex: Number(optionIndex),
          receipt,
          proof: {
            merkleTreeDepth: proof.merkleTreeDepth,
            merkleTreeRoot: proof.merkleTreeRoot,
            nullifier: proof.nullifier,
            message: proof.message,
            scope: proof.scope,
            points: proof.points.map((p) => p.toString()),
          },
        }),
      });

      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out?.error || "Relayer vote error");

      const net = await contract.runner.provider.getNetwork();
      markVotedLocally({
        chainId: net.chainId.toString(),
        electionAddress: addr,
        voterAddress: voterAddr,
        receipt,
        txHash: out.txHash || "",
      });
      addKnownElectionAddress(addr);

      setVoteMsg(`✅ Vote relayed privately!\nTx:\n${out.txHash}\n\nReceipt:\n${receipt}`);
      await load();
    } catch (e) {
      console.error(e);
      setVoteMsg("❌ " + normErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page vote-page">
      <div className="vote-head-row">
        <div className="vote-head-copy">
          <h1>Cast Ballot</h1>
          {isKioskMode && (
            <div className="vote-kiosk-meta">
              {title ? <div className="vote-kiosk-title">{title}</div> : null}
              {status ? (
                <span
                  className={`home-status home-status-${
                    status?.toLowerCase() === "open" ||
                    status?.toLowerCase() === "pending" ||
                    status?.toLowerCase() === "closed"
                      ? status.toLowerCase()
                      : "unknown"
                  }`}
                >
                  {status}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <div className="vote-mode-inline">
          <span className="vote-mode-chip">
            {useLocal ? "Local signer" : "MetaMask signer"}
          </span>
          <label className="admin-switch admin-switch-compact" title="Toggle signer mode">
            <input
              type="checkbox"
              className="admin-switch-input"
              data-testid="vote-use-local-toggle"
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
          <p className="hint">
            Dev mode only. Avoid using real private keys in browser input.
          </p>
          <label className="field">
            <span>Private Key</span>
            <input
              type={isKioskMode ? "text" : "password"}
              className="input"
              placeholder="0x…"
              value={pk}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setPk(e.target.value)}
            />
          </label>
        </section>
      )}

      {!isKioskMode && (
        <section className="card vote-info-card">
          <div className="kv">
            <b>Title:</b> {title || "—"}
          </div>
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
            <b>Candidates:</b> {candidates.length ? candidates.length : "—"}
          </div>
          <div className="kv">
            <b>Window:</b> {fmt(startTs)} to {fmt(endTs)}
          </div>
          <div className="actions actions-mobile-grid">
            <Link className="btn link" to={`/election/${addr}`}>
              <span className="btn-icon"><UiIcon name="back" /></span>
              Back to Election
            </Link>
            <Link className="btn link" to={`/election/${addr}/link`}>
              <span className="btn-icon"><UiIcon name="link" /></span>
              Link Identity
            </Link>
            <Link className="btn link" to={`/election/${addr}/tally`}>
              <span className="btn-icon"><UiIcon name="tally" /></span>
              Live Tally
            </Link>
          </div>
        </section>
      )}

      <section className="card vote-cast-card">
        {isKioskMode && status === "PENDING" && (
          <div className="vote-kiosk-assist">
            <p className="hint">
              This election is still pending. Complete identity linking before voting opens.
            </p>
            <Link className="btn link" to={`/election/${addr}/link`}>
              <span className="btn-icon"><UiIcon name="link" /></span>
              Open Link Identity
            </Link>
          </div>
        )}

        <label className="field">
          <span>Candidate</span>
          <select
            className="input"
            value={optionIndex}
            onChange={(e) => setOptionIndex(Number(e.target.value))}
          >
            {candidates.map((c, i) => (
              <option key={i} value={i}>
                {i} — {c}
              </option>
            ))}
          </select>
        </label>

        <div className="actions actions-mobile-grid">
          <button className="btn" onClick={castVote} disabled={!canVote || busy}>
            <span className={`btn-icon ${busy ? "is-spinning" : ""}`}>
              <UiIcon name={busy ? "refresh" : "vote"} />
            </span>
            {busy
              ? "Working…"
              : canVote
                ? "Cast Vote"
                : status === "PENDING"
                  ? "Vote Opens Soon"
                  : "Voting Closed"}
          </button>
        </div>

        <pre className="hint pre vote-msg-box">{voteMsg || "Ready."}</pre>
      </section>
    </div>
  );
}
