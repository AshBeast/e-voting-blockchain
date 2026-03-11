import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ethers } from "ethers";
import "../App.css";

const THEME_KEY = "home.theme";
const THEME_OPTIONS = [
  { id: "civic", label: "Civic Blue" },
  { id: "graphite", label: "Graphite" },
  { id: "dark", label: "Dark" },
];

function normalizeTheme(value) {
  const v = String(value || "").trim().toLowerCase();
  return THEME_OPTIONS.some((t) => t.id === v) ? v : "civic";
}

function navClass({ isActive }) {
  return isActive ? "app-nav-link app-nav-link-active" : "app-nav-link";
}

export default function AppLayout() {
  const location = useLocation();
  const year = new Date().getFullYear();
  const [theme, setTheme] = useState(() =>
    normalizeTheme(localStorage.getItem(THEME_KEY))
  );
  const [lastContract, setLastContract] = useState(
    () => localStorage.getItem("last_contract") || ""
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute("data-he-theme", theme);
  }, [theme]);

  useEffect(() => {
    setLastContract(localStorage.getItem("last_contract") || "");
  }, [location.pathname]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    if (mobileMenuOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  const lastElectionHref = useMemo(() => {
    if (!ethers.isAddress(lastContract)) return "";
    return `/election/${ethers.getAddress(lastContract)}`;
  }, [lastContract]);

  return (
    <div className="app-layout">
      <header className="app-topbar">
        <div className="app-brand">HE-Voting</div>

        <nav className="app-nav">
          <NavLink to="/" end className={navClass}>
            Home
          </NavLink>
          <NavLink to="/admin" className={navClass}>
            Admin
          </NavLink>
          <NavLink to="/watchdog" className={navClass}>
            Watchdog
          </NavLink>
          {lastElectionHref && (
            <NavLink to={lastElectionHref} className={navClass}>
              Last Election
            </NavLink>
          )}
        </nav>

        <div className="app-controls">
          <label htmlFor="global-theme">Theme</label>
          <select
            id="global-theme"
            value={theme}
            className="app-theme-select"
            onChange={(e) => setTheme(normalizeTheme(e.target.value))}
          >
            {THEME_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={`app-menu-toggle ${mobileMenuOpen ? "is-open" : ""}`}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <div
        className={`app-drawer-overlay ${mobileMenuOpen ? "open" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <aside className={`app-drawer ${mobileMenuOpen ? "open" : ""}`}>
        <div className="app-drawer-head">
          <div className="app-drawer-title">Menu</div>
          <button
            type="button"
            className="app-drawer-close"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
          >
            ✕
          </button>
        </div>

        <nav className="app-drawer-nav">
          <NavLink to="/" end className={navClass} onClick={() => setMobileMenuOpen(false)}>
            Home
          </NavLink>
          <NavLink to="/admin" className={navClass} onClick={() => setMobileMenuOpen(false)}>
            Admin
          </NavLink>
          <NavLink to="/watchdog" className={navClass} onClick={() => setMobileMenuOpen(false)}>
            Watchdog
          </NavLink>
          {lastElectionHref && (
            <NavLink to={lastElectionHref} className={navClass} onClick={() => setMobileMenuOpen(false)}>
              Last Election
            </NavLink>
          )}
        </nav>

        <div className="app-drawer-section">
          <label htmlFor="global-theme-mobile">Theme</label>
          <select
            id="global-theme-mobile"
            value={theme}
            className="app-theme-select app-drawer-theme-select"
            onChange={(e) => setTheme(normalizeTheme(e.target.value))}
          >
            {THEME_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </aside>

      <main className="app-content">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span className="app-footer-left">Hybrid Electronic Voting (HE-Voting)</span>
        <span className="app-footer-center" aria-hidden="true" />
        <span className="app-footer-right">Built by Ashkan Zahedanaraki • {year}</span>
      </footer>
    </div>
  );
}
