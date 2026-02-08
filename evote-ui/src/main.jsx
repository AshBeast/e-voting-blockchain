// evote-ui/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "./App.jsx";

// Pages
import AdminPage from "./pages/AdminPage.jsx";
import ElectionPage from "./pages/ElectionPage.jsx";
import VotePage from "./pages/VotePage.jsx";
import ReceiptPage from "./pages/ReceiptPage.jsx";

// Route wrappers (provider/chainId wiring)
import WatchdogRoute from "./routes/WatchdogRoute.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Home */}
        <Route path="/" element={<App />} />

        {/* Admin */}
        <Route path="/admin" element={<AdminPage />} />

        {/* Watchdog audit */}
        <Route path="/watchdog" element={<WatchdogRoute />} />
        <Route path="/watchdog/:addr" element={<WatchdogRoute />} />

        {/* Election routes */}
        <Route path="/election/:addr" element={<ElectionPage />} />
        <Route path="/election/:addr/vote" element={<VotePage />} />
        <Route path="/election/:addr/receipt" element={<ReceiptPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
