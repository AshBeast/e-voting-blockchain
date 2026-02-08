// evote-ui/src/lib/explorer.js
export function explorerBase(chainId) {
  switch (Number(chainId)) {
    case 1:
      return "https://etherscan.io";
    case 11155111:
      return "https://sepolia.etherscan.io";
    default:
      return null; // local Hardhat, unknown networks, etc.
  }
}

export function txLink(chainId, txHash) {
  const base = explorerBase(chainId);
  return base ? `${base}/tx/${txHash}` : null;
}

export function addressLink(chainId, address) {
  const base = explorerBase(chainId);
  return base ? `${base}/address/${address}` : null;
}
