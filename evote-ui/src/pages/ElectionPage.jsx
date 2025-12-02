/* eslint-disable no-unused-vars */
//ElectionPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import "../App.css";


const RPC = import.meta.env.VITE_RPC_URL || import.meta.env.VITE_LOCAL_RPC || "http://127.0.0.1:8545";

const ABI = [
  "function candidates() view returns (string[] memory)",
  "function tally() view returns (uint256[] memory)",
  "function candidateCount() view returns (uint256)",
  "function status() view returns (string memory)",
  "function electionInfo() view returns (string memory,uint64,uint64)",
];

export default function ElectionPage() {
  const { addr } = useParams();
  const navigate = useNavigate();

  const [provider, setProvider] = useState(null);
  const [contract, setContract] = useState(null);

  const [title, setTitle] = useState("");
  const [startTs, setStartTs] = useState(0);
  const [endTs, setEndTs] = useState(0);
  const [status, setStatus] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [tally, setTally] = useState([]);

  // guard + provider
  useEffect(() => {
    if (!ethers.isAddress(addr)) {
      navigate("/", { replace: true });
      return;
    }
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, [addr, navigate]);

  // contract
  useEffect(() => {
    if (!provider || !ethers.isAddress(addr)) return;
    setContract(new ethers.Contract(addr, ABI, provider));
  }, [provider, addr]);


  
async function nudgeChainIfStale(provider, startTs, endTs, status) {
  // Only helpful on local dev chains (Hardhat/Anvil). It's harmless elsewhere (will just throw).
  const now = Math.floor(Date.now() / 1000);

  // If we think we should be OPEN but chain is still PENDING, or should be CLOSED but still OPEN → mine one block.
  const shouldBeOpen = now >= Number(startTs) && now <= Number(endTs);
  const shouldBeClosed = now > Number(endTs);

  if ((status === "PENDING" && shouldBeOpen) || (status === "OPEN" && shouldBeClosed)) {
    try {
      // Align next block's timestamp to wall-clock then mine
      await provider.send("evm_setNextBlockTimestamp", [now]);
    } catch (print) {
      // Ignored on non-dev chains
    }
    try {
      await provider.send("evm_mine", []);
    } catch (print) {
      // Ignored on non-dev chains
    }
  }
}

async function load() {
  if (!contract) return;

  // 1) Read current on-chain snapshot
  const [nm, sTs, eTs] = await contract.electionInfo();
  let st = await contract.status();
  const cs = await contract.candidates();
  const tl = await contract.tally();

  // 2) Dev: if the wall-clock says we crossed a boundary but chain didn't, nudge and re-read
  await nudgeChainIfStale(provider, sTs, eTs, st);
  if (provider) {
    st = await contract.status(); // re-check after potential mine
  }

  // 3) Commit state
  setTitle(nm);
  setStartTs(Number(sTs));
  setEndTs(Number(eTs));
  setStatus(st);
  setCandidates(cs);
  setTally(tl.map((x) => x.toString()));
}

  // auto-refresh
  useEffect(() => {
    if (!contract) return;
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [contract]);

  // always display in Vancouver (PST/PDT)
  const fmt = (ts) =>
    ts
      ? new Date(Number(ts) * 1000).toLocaleString("en-CA", {
          timeZone: "America/Vancouver",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

  const canVote = useMemo(() => status === "OPEN", [status]);

  return (
    <div className="page">
      <h1>🗳️Election</h1>

      <section className="card">
        <div className="kv"><b>Contract:</b> <span className="mono">{addr}</span></div>
        <div className="kv"><b>Status:</b> {status || "—"}</div>
        <div className="kv"><b>Title:</b> {title || "—"}</div>
        <div className="kv"><b>Starts:</b> {fmt(startTs)}</div>
        <div className="kv"><b>Ends:</b> {fmt(endTs)}</div>

        <div className="actions">
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn" onClick={() => navigate("/")}>Change Contract</button>
          <Link className={`btn link ${!canVote ? "disabled" : ""}`} to={`/election/${addr}/vote`}>
            Cast Ballot
          </Link>
          <Link className="btn link" to={`/election/${addr}/receipt`}>
            Check Receipt
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>Live Tally</h2>
        {candidates.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Candidate</th>
                <th>Votes</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((name, i) => (
                <tr key={i}>
                  <td>{i}</td>
                  <td>{name}</td>
                  <td>{tally[i] ?? "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div>Loading…</div>
        )}
      </section>
    </div>
  );
}
