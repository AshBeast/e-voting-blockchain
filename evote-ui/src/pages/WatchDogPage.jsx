// evote-ui/src/pages/WatchDogPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";

import VotingArtifact from "../Voting.json";
import { txLink, addressLink } from "../lib/explorer";

export default function WatchDogPage({ provider, chainId, providerError }) {
  const { addr } = useParams();

  const [contractAddress, setContractAddress] = useState("");
  const [fromBlock, setFromBlock] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const iface = useMemo(() => new ethers.Interface(VotingArtifact.abi), []);

  // Auto-fill contract address from /watchdog/:addr
  useEffect(() => {
    if (addr && ethers.isAddress(addr)) {
      setContractAddress(addr);
      setError("");
    }
  }, [addr]);

  async function loadEvents({ forceFromBlock } = {}) {
    setError("");
    setRows([]);
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
      if (!ethers.isAddress(contractAddress)) {
        setError("Enter a valid Voting contract address.");
        return;
      }

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
        address: contractAddress,
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
          event: ev.name,
          args: ev.args,
          txHash: log.transactionHash,
        });
      }

      // newest first
      parsed.sort((a, b) => b.blockNumber - a.blockNumber);
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

  const contractExplorer = ethers.isAddress(contractAddress)
    ? addressLink(chainId, contractAddress)
    : null;

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <h2 style={{ marginBottom: 6 }}>Watchdog Audit Trail</h2>

      <div style={{ marginBottom: 12, color: "#555", fontSize: 14 }}>
        <div>
          Provider:{" "}
          {provider ? (
            <span style={{ color: "#166534" }}>connected</span>
          ) : (
            <span style={{ color: "#b91c1c" }}>not connected</span>
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

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <input
          value={contractAddress}
          onChange={(e) => setContractAddress(e.target.value.trim())}
          placeholder="Voting contract address (0x...)"
          style={{ width: 460, padding: 10, borderRadius: 8, border: "1px solid #d1d5db" }}
        />

        <input
          value={fromBlock}
          onChange={(e) => setFromBlock(e.target.value.trim())}
          placeholder="fromBlock (optional)"
          style={{ width: 180, padding: 10, borderRadius: 8, border: "1px solid #d1d5db" }}
        />

        <button
          onClick={() => loadEvents()}
          disabled={loading}
          style={btn}
        >
          {loading ? "Loading..." : "Load"}
        </button>

        <button
          onClick={() => loadEvents({ forceFromBlock: 0 })}
          disabled={loading}
          style={btn}
          title="Useful if you don't know what block your deployment started at"
        >
          Load from 0
        </button>

        <button
          onClick={() => {
            setRows([]);
            setError("");
          }}
          disabled={loading}
          style={btn}
        >
          Clear
        </button>
      </div>

      {providerError && (
        <div style={{ marginTop: 8, color: "#b91c1c" }}>
          ❌ {providerError}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, color: "#b91c1c" }}>
          ❌ {error}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {rows.length === 0 ? (
          <div style={{ color: "#555" }}>
            <p style={{ margin: 0 }}>No events yet.</p>
            <p style={{ marginTop: 6, fontSize: 13 }}>
              If you *expect* events: try <b>Load from 0</b>, double-check the contract address, and confirm your contract emits events.
            </p>
          </div>
        ) : (
          <table border="1" cellPadding="8" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th align="left">Time</th>
                <th align="left">Event</th>
                <th align="left">Details</th>
                <th align="left">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const link = txLink(chainId, r.txHash);
                return (
                  <tr key={idx}>
                    <td>{r.time}</td>
                    <td>{r.event}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {formatArgs(r.args)}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>
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
        )}
      </div>
    </div>
  );
}

const btn = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#f9fafb",
  cursor: "pointer",
};

function shortHash(h) {
  return h ? `${h.slice(0, 10)}…${h.slice(-8)}` : "";
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
