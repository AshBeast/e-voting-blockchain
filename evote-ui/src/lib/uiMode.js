import { ethers } from "ethers";

export const UI_MODE = String(import.meta.env.VITE_UI_MODE || "").trim().toLowerCase();

export const isKioskMode = UI_MODE === "kiosk";

const rawKioskElectionAddress = String(
  import.meta.env.VITE_KIOSK_ELECTION_ADDRESS || ""
).trim();

function normalizeAddress(value) {
  try {
    return ethers.getAddress(value);
  } catch {
    return "";
  }
}

export const kioskElectionAddress = normalizeAddress(rawKioskElectionAddress);
export const kioskBallotHref = kioskElectionAddress
  ? `/election/${kioskElectionAddress}/vote`
  : "";
