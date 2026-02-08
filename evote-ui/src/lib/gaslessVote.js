import { ethers } from "ethers";
import votingArtifact from "../Voting.json";
import forwarderArtifact from "../Forwarder.json";

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:8787";

// OpenZeppelin ERC2771Forwarder EIP-712 type
const FORWARD_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

export async function gaslessVote({ votingAddress, optionIndex, receiptHex }) {
  if (!window.ethereum) throw new Error("MetaMask not found");

  const bp = new ethers.BrowserProvider(window.ethereum);
  await bp.send("eth_requestAccounts", []);
  const signer = await bp.getSigner();
  const from = await signer.getAddress();

  const provider = bp; // BrowserProvider works for reads
  const voting = new ethers.Contract(votingAddress, votingArtifact.abi, provider);

  // Read the trusted forwarder from the election contract
  const forwarderAddr = await voting.trustedForwarder();
  const forwarder = new ethers.Contract(forwarderAddr, forwarderArtifact.abi, provider);

  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);

  // Encode the call the forwarder will make
  const iface = new ethers.Interface(votingArtifact.abi);
  const data = iface.encodeFunctionData("vote", [optionIndex, receiptHex]);

  const nonce = await forwarder.nonces(from);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes

  // Estimate gas for the *inner* call (forwarder -> voting)
  const innerEst = await provider.estimateGas({
    from: forwarderAddr,
    to: votingAddress,
    data,
  });

  const request = {
    from,
    to: votingAddress,
    value: "0",
    gas: (innerEst + innerEst / 5n).toString(), // +20%
    nonce: nonce.toString(),
    deadline, // uint48 is fine here
    data,
  };

  // Domain name must match the name you gave the forwarder constructor.
  // Your Forwarder.sol: ERC2771Forwarder("E-VotingForwarder")
  const domain = {
    name: "E-VotingForwarder",
    version: "1",
    chainId,
    verifyingContract: forwarderAddr,
  };

  // Voter signs (no gas) in MetaMask
  const signature = await signer.signTypedData(domain, FORWARD_TYPES, request);

  // Relayer submits on-chain (relayer pays gas)
  const r = await fetch(`${RELAYER_URL}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ forwarder: forwarderAddr, request, signature }),
  });

  const out = await r.json();
  if (!r.ok) throw new Error(out?.error || "Relayer error");

  return { txHash: out.txHash, forwarder: forwarderAddr };
}
