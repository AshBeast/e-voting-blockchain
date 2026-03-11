// evote-ui/src/pages/WatchDogPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";

import VotingArtifact from "../Voting.json";
import UiIcon from "../components/UiIcon";
import { txLink, addressLink } from "../lib/explorer";
import "../App.css";

const DEFAULT_PAGE_SIZE = 25;

export default function WatchDogPage({ provider, chainId, providerError }) {
  const { addr } = useParams();

  const [contractAddress, setContractAddress] = useState("");
  const [fromBlock, setFromBlock] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const iface = useMemo(() => new ethers.Interface(VotingArtifact.abi), []);

  // Auto-fill contract address from /watchdog/:addr
  useEffect(() => {
    const normalized = firstAddress(addr || "");
    if (normalized) {
      setContractAddress(normalized);
      setError("");
    }
  }, [addr]);

  const normalizedContract = useMemo(
    () => firstAddress(contractAddress),
    [contractAddress]
  );

  async function loadEvents({ forceFromBlock } = {}) {
    setError("");
    setRows([]);
    setPage(1);
    setLoading(true);

    try {
      if (providerError) {
        setError(providerError);
        return;
      }
      if (!provider) {
        setError("No provider connected. (No MetaMask and no RPC fallback)");
        return;
      }
      if (!normalizedContract) {
        setError("Enter a valid Voting contract address.");
        return;
      }
      setContractAddress(normalizedContract);

      const latest = await provider.getBlockNumber();

      // Decide fromBlock
      let startBlock;
      if (typeof forceFromBlock === "number") {
        startBlock = forceFromBlock;
      } else if (fromBlock !== "") {
        const n = Number(fromBlock);
        if (!Number.isFinite(n) || n < 0) {
          setError("fromBlock must be a non-negative number.");
          return;
        }
        startBlock = n;
      } else {
        startBlock = Math.max(latest - 50_000, 0);
      }

      const logs = await provider.getLogs({
        address: normalizedContract,
        fromBlock: startBlock,
        toBlock: latest,
      });

      // Cache blocks so timestamp lookup is fast
      const blockCache = new Map(); // blockNumber -> block

      const parsed = [];
      for (const log of logs) {
        let ev;
        try {
          ev = iface.parseLog(log);
        } catch {
          continue; // not one of our ABI events
        }

        let block = blockCache.get(log.blockNumber);
        if (!block) {
          block = await provider.getBlock(log.blockNumber);
          blockCache.set(log.blockNumber, block);
        }

        const ts = block?.timestamp ? new Date(Number(block.timestamp) * 1000) : null;

        parsed.push({
          time: ts ? ts.toLocaleString() : `Block ${log.blockNumber}`,
          blockNumber: log.blockNumber,
          logIndex: Number(log.index ?? 0),
          event: ev.name,
          args: ev.args,
          txHash: log.transactionHash,
        });
      }

      // newest first
      parsed.sort((a, b) => {
        if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
        return b.logIndex - a.logIndex;
      });
      setRows(parsed);

      if (parsed.length === 0) {
        // Helpful hint if empty
        // (Don’t force an error; just give a tip)
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const contractExplorer = normalizedContract
    ? addressLink(chainId, normalizedContract)
    : null;

  const displayRows = useMemo(() => makeDisplayRows(rows), [rows]);
  const totalPages = Math.max(1, Math.ceil(displayRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return displayRows.slice(start, start + pageSize);
  }, [displayRows, pageSize, safePage]);

  return (
    <div className="watchdog-page">
      <h2 style={{ marginBottom: 6 }}>Watchdog Audit Trail</h2>

      <div className="watchdog-meta">
        <div>
          Provider:{" "}
          {provider ? (
            <span className="home-status home-status-open">connected</span>
          ) : (
            <span className="home-status home-status-closed">not connected</span>
          )}
          {typeof chainId === "number" && (
            <span> • chainId: {chainId}</span>
          )}
        </div>

        {contractExplorer && (
          <div>
            Contract:{" "}
            <a href={contractExplorer} target="_blank" rel="noreferrer">
              {contractAddress}
            </a>
          </div>
        )}
      </div>

      <div className="watchdog-row">
        <input
          value={contractAddress}
          onChange={(e) => setContractAddress(e.target.value)}
          placeholder="Voting contract address (0x...)"
          className="watchdog-input watchdog-input-address"
        />

        <input
          value={fromBlock}
          onChange={(e) => setFromBlock(e.target.value.trim())}
          placeholder="fromBlock (optional)"
          className="watchdog-input watchdog-input-block"
        />

        <button
          onClick={() => loadEvents()}
          disabled={loading}
          className="btn"
        >
          <span className={`btn-icon ${loading ? "is-spinning" : ""}`}>
            <UiIcon name={loading ? "refresh" : "load"} />
          </span>
          {loading ? "Loading..." : "Load"}
        </button>

        <button
          onClick={() => loadEvents({ forceFromBlock: 0 })}
          disabled={loading}
          className="btn"
          title="Useful if you don't know what block your deployment started at"
        >
          <span className={`btn-icon ${loading ? "is-spinning" : ""}`}>
            <UiIcon name={loading ? "refresh" : "load"} />
          </span>
          Load from 0
        </button>

        <button
          onClick={() => {
            setRows([]);
            setPage(1);
            setError("");
          }}
          disabled={loading}
          className="btn"
        >
          <span className="btn-icon">
            <UiIcon name="clear" />
          </span>
          Clear
        </button>
      </div>

      {providerError && (
        <div className="watchdog-error">
          ❌ {providerError}
        </div>
      )}

      {error && (
        <div className="watchdog-error">
          ❌ {error}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {rows.length === 0 ? (
          <div className="watchdog-empty">
            <p style={{ margin: 0 }}>No events yet.</p>
            <p style={{ marginTop: 6, fontSize: 13 }}>
              If you *expect* events: try <b>Load from 0</b>, double-check the contract address, and confirm your contract emits events.
            </p>
          </div>
        ) : (
          <>
            <div className="watchdog-toolbar">
              <div className="watchdog-summary">
                Showing {pageRows.length} of {displayRows.length} rows ({rows.length} events)
              </div>
              <div className="watchdog-toolbar-controls">
                <label className="watchdog-page-size">
                  Per page
                  <select
                    className="watchdog-input"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="watchdog-table-wrap">
              <table className="watchdog-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Details</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, idx) => {
                    if (r.kind === "voter-group") {
                      const link = txLink(chainId, r.txHash);
                      return (
                        <tr key={r.key}>
                          <td data-label="Time">{r.time}</td>
                          <td data-label="Event">VoterRegistered × {r.entries.length}</td>
                          <td data-label="Details" className="watchdog-mono">
                            <details className="watchdog-group-details">
                              <summary>Show voters</summary>
                              <div className="watchdog-group-list">
                                {r.entries.map((entry, entryIdx) => (
                                  <div
                                    className="watchdog-group-item"
                                    key={`${entry.txHash}-${entry.blockNumber}-${entry.logIndex}`}
                                  >
                                    <span className="watchdog-group-index">{entryIdx + 1}.</span>
                                    <span>{voterAddressFromArgs(entry.args)}</span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </td>
                          <td data-label="Tx" className="watchdog-mono">
                            {link ? (
                              <a href={link} target="_blank" rel="noreferrer">
                                {shortHash(r.txHash)}
                              </a>
                            ) : (
                              shortHash(r.txHash)
                            )}
                          </td>
                        </tr>
                      );
                    }

                    const link = txLink(chainId, r.txHash);
                    return (
                      <tr key={`${r.txHash}-${r.blockNumber}-${idx}`}>
                        <td data-label="Time">{r.time}</td>
                        <td data-label="Event">{r.event}</td>
                        <td data-label="Details" className="watchdog-mono">
                          {formatArgs(r.args)}
                        </td>
                        <td data-label="Tx" className="watchdog-mono">
                          {link ? (
                            <a href={link} target="_blank" rel="noreferrer">
                              {shortHash(r.txHash)}
                            </a>
                          ) : (
                            shortHash(r.txHash)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="watchdog-pagination">
              <button
                type="button"
                className="btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                <span className="btn-icon"><UiIcon name="prev" /></span>
                Prev
              </button>
              <span>
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                <span className="btn-icon"><UiIcon name="next" /></span>
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function shortHash(h) {
  return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : "";
}

function voterAddressFromArgs(args) {
  if (!args) return "";
  const raw =
    typeof args?.voter === "string"
      ? args.voter
      : typeof args?.[0] === "string"
        ? args[0]
        : "";
  if (!raw) return "";
  try {
    return ethers.getAddress(raw);
  } catch {
    return String(raw);
  }
}

function firstAddress(input) {
  if (typeof input !== "string") return "";
  const m = input.match(/0x[a-fA-F0-9]{40}\b/);
  if (!m) return "";
  try {
    return ethers.getAddress(m[0]);
  } catch {
    return "";
  }
}

function makeDisplayRows(rows) {
  const out = [];

  for (let i = 0; i < rows.length; ) {
    const row = rows[i];
    if (row.event !== "VoterRegistered") {
      out.push(row);
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < rows.length) {
      const next = rows[j];
      if (next.event !== "VoterRegistered") break;
      if (next.txHash !== row.txHash) break;
      j += 1;
    }

    const group = rows.slice(i, j);
    if (group.length === 1) {
      out.push(row);
    } else {
      out.push({
        kind: "voter-group",
        key: `voter-group-${row.txHash}-${row.blockNumber}-${row.logIndex}-${group.length}`,
        time: row.time,
        txHash: row.txHash,
        entries: group,
      });
    }

    i = j;
  }

  return out;
}

function formatArgs(args) {
  if (!args) return "";

  // ethers v6 args is array-like with named keys too.
  // Prefer named keys if present.
  const namedKeys = Object.keys(args).filter((k) => Number.isNaN(Number(k)));

  if (namedKeys.length > 0) {
    return namedKeys
      .map((k) => `${k}=${safeToString(args[k])}`)
      .join(", ");
  }

  // fallback: indexed
  const indexed = [];
  for (let i = 0; i < args.length; i++) indexed.push(safeToString(args[i]));
  return indexed.join(", ");
}

function safeToString(v) {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return `[${v.map(safeToString).join(", ")}]`;
  if (v && typeof v === "object") {
    // address-like objects shouldn't happen here, but keep it safe
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}
