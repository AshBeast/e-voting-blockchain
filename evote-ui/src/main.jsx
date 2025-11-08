// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "./App";                               // Home (address gate)
import AdminPage from "./pages/AdminPage.jsx";         // your existing admin page
import ElectionPage from "./pages/ElectionPage.jsx";   // new
import VotePage from "./pages/VotePage.jsx";           // placeholder
import ReceiptPage from "./pages/ReceiptPage.jsx";     // placeholder

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/admin" element={<AdminPage />} />

      {/* Election routes */}
      <Route path="/election/:addr" element={<ElectionPage />} />
      <Route path="/election/:addr/vote" element={<VotePage />} />
      <Route path="/election/:addr/receipt" element={<ReceiptPage />} />
    </Routes>
  </BrowserRouter>
);
