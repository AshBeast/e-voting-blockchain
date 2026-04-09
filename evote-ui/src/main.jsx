// evote-ui/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import "./index.css";

import App from "./App.jsx";
import AppLayout from "./layout/AppLayout.jsx";
import { isKioskMode, kioskBallotHref } from "./lib/uiMode";

// Pages
import AdminPage from "./pages/AdminPage.jsx";
import ElectionPage from "./pages/ElectionPage.jsx";
import VotePage from "./pages/VotePage.jsx";
import LinkIdentityPage from "./pages/LinkIdentityPage.jsx";
import ReceiptPage from "./pages/ReceiptPage.jsx";
import LiveTallyPage from "./pages/LiveTallyPage.jsx";

// Route wrappers (provider/chainId wiring)
import WatchdogRoute from "./routes/WatchdogRoute.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Home */}
          <Route
            path="/"
            element={
              isKioskMode && kioskBallotHref ? <Navigate to={kioskBallotHref} replace /> : <App />
            }
          />

          {/* Admin */}
          <Route
            path="/admin"
            element={isKioskMode ? <Navigate to="/" replace /> : <AdminPage />}
          />

          {/* Watchdog audit */}
          <Route
            path="/watchdog"
            element={isKioskMode ? <Navigate to="/" replace /> : <WatchdogRoute />}
          />
          <Route
            path="/watchdog/:addr"
            element={isKioskMode ? <Navigate to="/" replace /> : <WatchdogRoute />}
          />

          {/* Election routes */}
          <Route path="/election/:addr" element={<ElectionPage />} />
          <Route path="/election/:addr/link" element={<LinkIdentityPage />} />
          <Route path="/election/:addr/vote" element={<VotePage />} />
          <Route path="/election/:addr/receipt" element={<ReceiptPage />} />
          <Route path="/election/:addr/tally" element={<LiveTallyPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
