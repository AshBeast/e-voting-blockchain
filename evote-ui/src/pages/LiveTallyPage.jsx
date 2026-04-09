import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ethers } from "ethers";
import UiIcon from "../components/UiIcon";
import { friendlyUiError } from "../lib/errors";

const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";

const ABI = [
  "function candidates() view returns (string[] memory)",
  "function tally() view returns (uint256[] memory)",
  "function status() view returns (string memory)",
  "function electionInfo() view returns (string memory,uint64,uint64)",
];

const CHART_COLORS = [
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#a855f7",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
];

function sum(arr) {
  return arr.reduce((acc, x) => acc + Number(x || 0), 0);
}

function fmtTs(ts) {
  if (!ts) return "—";
  return new Date(Number(ts) * 1000).toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildPieGradient(values) {
  const numeric = values.map((v) => Math.max(0, Number(v || 0)));
  const total = sum(numeric);
  if (total <= 0) {
    return "conic-gradient(from -90deg, #1f2937 0deg, #334155 360deg)";
  }

  let current = 0;
  const stops = [];
  for (let idx = 0; idx < numeric.length; idx++) {
    const value = numeric[idx];
    if (value <= 0) continue;

    const slice = (value / total) * 360;
    const from = current;
    const to = Math.min(360, current + slice);
    const color = CHART_COLORS[idx % CHART_COLORS.length];

    if (to - from > 0.0001) {
      stops.push(`${color} ${from.toFixed(4)}deg ${to.toFixed(4)}deg`);
    }

    current = to;
  }

  if (stops.length === 0) {
    return "conic-gradient(from -90deg, #1f2937 0deg, #334155 360deg)";
  }

  return `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

async function nudgeChainIfStale(provider, startTs, endTs, status) {
  const now = Math.floor(Date.now() / 1000);
  const shouldBeOpen = now >= Number(startTs) && now <= Number(endTs);
  const shouldBeClosed = now > Number(endTs);

  if ((status === "PENDING" && shouldBeOpen) || (status === "OPEN" && shouldBeClosed)) {
    try {
      await provider.send("evm_setNextBlockTimestamp", [now]);
    } catch {
      // ignored on non-local chains
    }
    try {
      await provider.send("evm_mine", []);
    } catch {
      // ignored on non-local chains
    }
  }
}

export default function LiveTallyPage() {
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
  const [chartMode, setChartMode] = useState("bar");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    if (!ethers.isAddress(addr)) {
      navigate("/", { replace: true });
      return;
    }
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, [addr, navigate]);

  useEffect(() => {
    if (!provider || !ethers.isAddress(addr)) return;
    setContract(new ethers.Contract(addr, ABI, provider));
  }, [provider, addr]);

  async function load(forceBusy = false) {
    if (!contract || !provider) return;
    if (forceBusy) setLoading(true);
    setLoadErr("");

    try {
      const [info, st, cs, tl] = await Promise.all([
        contract.electionInfo(),
        contract.status(),
        contract.candidates(),
        contract.tally(),
      ]);

      const [name, sTs, eTs] = info;
      let statusNow = st;

      await nudgeChainIfStale(provider, sTs, eTs, statusNow);
      statusNow = await contract.status();

      setTitle(name);
      setStartTs(Number(sTs));
      setEndTs(Number(eTs));
      setStatus(statusNow);
      setCandidates(cs);
      setTally(tl.map((x) => Number(x)));
      setLastUpdatedAt(Date.now());
    } catch (e) {
      console.error(e);
      setLoadErr(friendlyUiError(e));
    } finally {
      if (forceBusy) setLoading(false);
    }
  }

  useEffect(() => {
    if (!contract) return;
    void load(true);
    const id = setInterval(() => {
      void load(false);
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);

  const totalVotes = useMemo(() => sum(tally), [tally]);
  const maxVotes = useMemo(() => Math.max(1, ...tally, 0), [tally]);
  const pieGradient = useMemo(() => buildPieGradient(tally), [tally]);

  const rows = useMemo(() => {
    return candidates
      .map((name, index) => ({
        index,
        name,
        votes: Number(tally[index] || 0),
        color: CHART_COLORS[index % CHART_COLORS.length],
      }))
      .sort((a, b) => b.votes - a.votes);
  }, [candidates, tally]);

  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString("en-CA", {
        timeZone: "America/Vancouver",
      })
    : "—";

  return (
    <div className="tally-tv-shell">
      <header className="tally-tv-header">
        <div className="tally-tv-title-wrap">
          <h1 className="tally-tv-title">{title || "Live Tally"}</h1>
          <div className="tally-tv-subtitle">
            <span className="mono">{addr}</span>
            <span>Start: {fmtTs(startTs)}</span>
            <span>End: {fmtTs(endTs)}</span>
          </div>
        </div>

        <div className="tally-tv-live-wrap">
          <span className={`tally-live-pill ${status === "OPEN" ? "tally-live-on" : ""}`}>
            <span className="tally-live-dot" />
            LIVE FEED
          </span>
          <span className="tally-status-pill">{status || "UNKNOWN"}</span>
        </div>
      </header>

      <section className="tally-tv-toolbar">
        <div className="tally-tv-toolbar-group">
          <button
            type="button"
            className={`tally-tv-btn ${chartMode === "bar" ? "tally-tv-btn-active" : ""}`}
            onClick={() => setChartMode("bar")}
          >
            <span className="btn-icon"><UiIcon name="tally" /></span>
            Bar Graph
          </button>
          <button
            type="button"
            className={`tally-tv-btn ${chartMode === "pie" ? "tally-tv-btn-active" : ""}`}
            onClick={() => setChartMode("pie")}
          >
            <span className="btn-icon"><UiIcon name="users" /></span>
            Pie Chart
          </button>
        </div>

        <div className="tally-tv-toolbar-group">
          <button
            type="button"
            className="tally-tv-btn"
            onClick={() => {
              void load(true);
            }}
            disabled={loading}
          >
            <span className={`btn-icon ${loading ? "is-spinning" : ""}`}>
              <UiIcon name="refresh" />
            </span>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <Link to={`/election/${addr}`} className="tally-tv-btn tally-tv-link">
            <span className="btn-icon"><UiIcon name="back" /></span>
            Back
          </Link>
        </div>
      </section>

      {loadErr && <div className="tally-tv-error">Error: {loadErr}</div>}

      <section className="tally-tv-grid">
        <article className="tally-tv-card tally-tv-chart-card">
          <div className="tally-tv-card-head">
            <h2>Live Tally</h2>
            <span>Total Votes: {totalVotes}</span>
          </div>

          {chartMode === "bar" ? (
            <div className="tally-bars">
              {rows.map((row, idx) => {
                const widthPct = row.votes <= 0 ? 0 : (row.votes / maxVotes) * 100;
                return (
                  <div key={row.index} className="tally-bar-row">
                    <div className="tally-bar-label">
                      {row.name}
                      <span>{row.votes}</span>
                    </div>
                    <div className="tally-bar-track">
                      <div
                        className="tally-bar-fill"
                        style={{
                          width: `${widthPct}%`,
                          background: `linear-gradient(90deg, ${row.color}, color-mix(in srgb, ${row.color} 45%, white 55%))`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tally-pie-wrap">
              <div className="tally-pie" style={{ background: pieGradient }} />
              <div className="tally-legend">
                {rows.map((row, idx) => {
                  const pct = totalVotes > 0 ? ((row.votes / totalVotes) * 100).toFixed(1) : "0.0";
                  return (
                    <div key={row.index} className="tally-legend-row">
                      <span
                        className="tally-legend-swatch"
                        style={{ background: row.color }}
                      />
                      <span className="tally-legend-name">{row.name}</span>
                      <span className="tally-legend-votes">
                        {row.votes} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </article>

        <article className="tally-tv-card">
          <div className="tally-tv-card-head">
            <h2>Scoreboard</h2>
            <span>Updated: {lastUpdatedLabel} PT</span>
          </div>

          <table className="tally-score-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Candidate</th>
                <th>Votes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.index}>
                  <td>{idx + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.votes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>
    </div>
  );
}
