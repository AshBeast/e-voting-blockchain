// evote-ui/src/routes/WatchdogRoute.jsx
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import WatchDogPage from "../pages/WatchDogPage.jsx";
import { friendlyUiError } from "../lib/errors";

/**
 * Provider selection rules:
 * - If VITE_RPC_URL is set (e.g., .env.sepolia), use it (Sepolia).
 * - Otherwise use VITE_LOCAL_RPC (default: http://127.0.0.1:8545).
 *
 * This makes:
 * - pnpm dev                 -> local hardhat
 * - pnpm dev --mode sepolia  -> sepolia via Infura
 *
 * Optional env:
 * - VITE_CHAIN_ID (sepolia) / VITE_LOCAL_CHAIN_ID (local)
 */
export default function WatchdogRoute() {
  const [provider, setProvider] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [providerError, setProviderError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setProviderError("");

        const rpcUrl =
          import.meta.env.VITE_RPC_URL ||
          import.meta.env.VITE_LOCAL_RPC ||
          "http://127.0.0.1:8545";

        // Prefer env-declared chain id (more deterministic)
        const desiredChainIdRaw =
          import.meta.env.VITE_CHAIN_ID || import.meta.env.VITE_LOCAL_CHAIN_ID;

        const desiredChainId = desiredChainIdRaw ? Number(desiredChainIdRaw) : null;

        // Always use JSON-RPC provider based on env (avoids MetaMask network confusion)
        const p = new ethers.JsonRpcProvider(rpcUrl);

        if (cancelled) return;
        setProvider(p);

        // Try to detect actual chainId from the RPC
        const net = await p.getNetwork();
        const actualChainId = Number(net.chainId);

        if (cancelled) return;

        // Prefer env chainId if provided, otherwise use actual
        setChainId(Number.isFinite(desiredChainId) ? desiredChainId : actualChainId);

        // Helpful sanity check: if env chainId is set but doesn't match RPC, show warning
        if (
          Number.isFinite(desiredChainId) &&
          Number.isFinite(actualChainId) &&
          desiredChainId !== actualChainId
        ) {
          setProviderError(
            `ChainId mismatch: env says ${desiredChainId} but RPC reports ${actualChainId}. ` +
              `Check your .env / --mode and RPC URL.`
          );
        }
      } catch (e) {
        if (cancelled) return;
        setProviderError(friendlyUiError(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <WatchDogPage provider={provider} chainId={chainId} providerError={providerError} />
  );
}
