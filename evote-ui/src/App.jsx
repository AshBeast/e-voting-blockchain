import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useNavigate } from "react-router-dom";
import UiIcon from "./components/UiIcon";

const RPC =
  import.meta.env.VITE_RPC_URL ||
  import.meta.env.VITE_LOCAL_RPC ||
  "http://127.0.0.1:8545";
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:8787";
const PAGE_SIZE = 10;

const HOME_ABI = [
  "function status() view returns (string)",
  "function electionInfo() view returns (string,uint64,uint64)",
];

async function loadElectionEntriesFromRelayer(chainId, page, pageSize) {
  const query = new URLSearchParams({
    chainId: String(chainId),
    page: String(page),
    pageSize: String(pageSize),
  });
  const url = `${RELAYER_URL}/elections?${query.toString()}`;
  const r = await fetch(url);
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out?.error || "Failed to load election registry");
  const list = Array.isArray(out?.elections) ? out.elections : [];
  const dedup = new Map();

  for (const e of list) {
    const raw = e?.address;
    if (typeof raw !== "string") continue;
    try {
      const address = ethers.getAddress(raw);
      if (!dedup.has(address)) {
        dedup.set(address, {
          address,
          title: typeof e?.title === "string" ? e.title : "",
          startTs: e?.startTs == null || e?.startTs === "" ? 0 : Number(e.startTs),
          endTs: e?.endTs == null || e?.endTs === "" ? 0 : Number(e.endTs),
        });
      }
    } catch {
      // ignore malformed addresses
    }
  }

  return {
    entries: Array.from(dedup.values()),
    total: Number(out?.total || 0),
    page: Number(out?.page || page),
    pageSize: Number(out?.pageSize || pageSize),
    totalPages: Number(out?.totalPages || 1),
  };
}

export default function App() {
  const navigate = useNavigate();
  const [provider, setProvider] = useState(null);
  const [chainId, setChainId] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listErr, setListErr] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [manualAddr, setManualAddr] = useState(
    localStorage.getItem("last_contract") || ""
  );
  const [openErr, setOpenErr] = useState("");

  useEffect(() => {
    setProvider(new ethers.JsonRpcProvider(RPC));
  }, []);

  useEffect(() => {
    if (!provider) return;
    void refreshElections(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function refreshElections(targetPage = page) {
    if (!provider) return;
    setLoading(true);
    setListErr("");
    setScanMsg("");

    try {
      setScanMsg("Loading network info...");
      const net = await provider.getNetwork();
      const currentChainId = net.chainId.toString();
      setChainId(currentChainId);

      setScanMsg("Loading election addresses from relayer...");
      const discovered = await loadElectionEntriesFromRelayer(
        currentChainId,
        targetPage,
        PAGE_SIZE
      );
      setPage(discovered.page);
      setTotalPages(Math.max(1, discovered.totalPages));
      setTotalCount(Math.max(0, discovered.total));

      if (discovered.entries.length === 0) {
        setRows([]);
        setScanMsg("No elections in relayer registry for this chain.");
        return;
      }

      setScanMsg(
        `Found ${discovered.total} election(s). Loading page ${discovered.page}/${Math.max(
          1,
          discovered.totalPages
        )}...`
      );
      const out = [];

      for (const entry of discovered.entries) {
        const electionAddress = entry.address;
        try {
          const c = new ethers.Contract(electionAddress, HOME_ABI, provider);
          const [info, status] = await Promise.all([c.electionInfo(), c.status()]);
          const [title, startTs, endTs] = info;
          out.push({
            address: electionAddress,
            title,
            startTs: Number(startTs),
            endTs: Number(endTs),
            status,
          });
        } catch (e) {
          out.push({
            address: electionAddress,
            title: entry.title || "(unreadable on current RPC)",
            startTs: Number(entry.startTs) || 0,
            endTs: Number(entry.endTs) || 0,
            status: "UNKNOWN",
            error: e?.message || String(e),
          });
        }
      }

      setRows(out);
      setScanMsg(
        `Loaded ${out.length} election(s) on page ${discovered.page}/${Math.max(
          1,
          discovered.totalPages
        )}.`
      );
    } catch (e) {
      setRows([]);
      setListErr(e?.message || String(e));
      setScanMsg("");
    } finally {
      setLoading(false);
    }
  }

  function goManual() {
    if (!ethers.isAddress(manualAddr)) {
      setOpenErr("Enter a valid Ethereum address (0x + 40 hex).");
      return;
    }
    const normalized = ethers.getAddress(manualAddr);
    localStorage.setItem("last_contract", normalized);
    navigate(`/election/${normalized}`);
  }

  function openElection(electionAddress) {
    localStorage.setItem("last_contract", electionAddress);
    navigate(`/election/${electionAddress}`);
  }

  function changePage(nextPage) {
    if (loading) return;
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    setPage(nextPage);
    void refreshElections(nextPage);
  }

  const ongoing = useMemo(() => rows.filter((r) => r.status === "OPEN"), [rows]);
  const pageNumbers = useMemo(
    () => Array.from({ length: Math.max(1, totalPages) }, (_, i) => i + 1),
    [totalPages]
  );

  const fmt = (ts) =>
    ts
      ? new Date(Number(ts) * 1000).toLocaleString("en-CA", {
          timeZone: "America/Vancouver",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "-";

  return (
    <div className="home-shell">
      <div className="home-container">
        <header className="home-hero">
          <h1>HE-Voting</h1>
          <p>
            Public election listing comes from relayer registry plus live on-chain
            reads. No wallet connection required.
          </p>
        </header>

        <section className="home-card">
          <h3>Election Registry</h3>
          <div className="home-row">
            <button
              onClick={() => void refreshElections(page)}
              className="home-btn"
              disabled={loading}
              type="button"
            >
              <span className={`btn-icon ${loading ? "is-spinning" : ""}`}>
                <UiIcon name="refresh" />
              </span>
              {loading ? "Loading..." : "Refresh Elections"}
            </button>
            <span>RPC Chain ID: {chainId || "-"}</span>
            <span>Relayer: {RELAYER_URL}</span>
            <span>
              Total: {totalCount} (showing {PAGE_SIZE} per page)
            </span>
          </div>
          {scanMsg && <div className="home-note">{scanMsg}</div>}
          {listErr && <div className="home-error">Error: {listErr}</div>}
        </section>

        <section className="home-card">
          <h3>Ongoing Elections On This Page ({ongoing.length})</h3>
          {ongoing.length === 0 ? (
            <div className="home-muted">No open elections found.</div>
          ) : (
            <ElectionTable rows={ongoing} onOpen={openElection} fmt={fmt} />
          )}
        </section>

        <section className="home-card">
          <h3>
            All Discovered Elections - Page {page}/{Math.max(1, totalPages)}
          </h3>
          {rows.length === 0 ? (
            <div className="home-muted">No elections discovered yet.</div>
          ) : (
            <ElectionTable rows={rows} onOpen={openElection} fmt={fmt} />
          )}
          <div className="home-pagination">
            <button
              type="button"
              onClick={() => changePage(page - 1)}
              className="home-btn"
              disabled={loading || page <= 1}
            >
              <span className="btn-icon"><UiIcon name="prev" /></span>
              Prev
            </button>
            {pageNumbers.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => changePage(p)}
                className={p === page ? "home-btn home-btn-active home-page-num" : "home-btn home-page-num"}
                disabled={loading}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => changePage(page + 1)}
              className="home-btn"
              disabled={loading || page >= totalPages}
            >
              <span className="btn-icon"><UiIcon name="next" /></span>
              Next
            </button>
          </div>
          {totalPages === 1 && (
            <div className="home-muted" style={{ marginTop: 8 }}>
              Only one page is available right now.
            </div>
          )}
        </section>

        <section className="home-card">
          <h3>Manual Open</h3>
          <input
            value={manualAddr}
            onChange={(e) => setManualAddr(e.target.value.trim())}
            placeholder="0x..."
            className="home-input mono"
          />
          <div className="home-row">
            <button type="button" onClick={goManual} className="home-btn">
              <span className="btn-icon"><UiIcon name="switch" /></span>
              Open Election
            </button>
            <button
              type="button"
              className="home-btn"
              onClick={() => {
                const last = localStorage.getItem("last_contract");
                if (last) {
                  setManualAddr(last);
                  setOpenErr("");
                }
              }}
            >
              <span className="btn-icon"><UiIcon name="search" /></span>
              Use Last
            </button>
          </div>
          {openErr && <div className="home-error">Error: {openErr}</div>}
        </section>
      </div>
    </div>
  );
}

function ElectionTable({ rows, onOpen, fmt }) {
  return (
    <div className="home-table-wrap">
      <table className="home-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Start</th>
            <th>End</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const statusClass = String(r.status || "UNKNOWN").toLowerCase();
            return (
              <tr key={r.address}>
                <td data-label="Title" className="home-title-cell">
                  <div className="home-title-main">{r.title || "-"}</div>
                  <div className="mono home-address">{r.address}</div>
                  {r.error && <div className="home-error-text">{r.error}</div>}
                </td>
                <td data-label="Status">
                  <span className={`home-status home-status-${statusClass}`}>
                    {r.status || "-"}
                  </span>
                </td>
                <td data-label="Start">{fmt(r.startTs)}</td>
                <td data-label="End">{fmt(r.endTs)}</td>
                <td data-label="Action">
                  <button
                    className="home-btn"
                    type="button"
                    onClick={() => onOpen(r.address)}
                  >
                    <span className="btn-icon"><UiIcon name="switch" /></span>
                    Open
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
