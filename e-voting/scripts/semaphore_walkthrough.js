#!/usr/bin/env node

const { randomBytes } = require("crypto");
const { ethers } = require("ethers");
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");
const { generateProof } = require("@semaphore-protocol/proof");

const votingArtifact = require("../../evote-ui/src/Voting.json");
const { resolveSemaphoreSnarkArtifacts } = require("../test/utils/snark-artifacts");

const DEFAULT_VOTER_PRIVATE_KEY =
  "0xca01c3598a4f70929d561896cff1ffdfd66ac99cd0f41bccca614d713fa019d3";
const DEFAULT_EXPECTED_VOTER_ADDRESS =
  "0xff0c350d9fFAB667a6C70465ee25b8ae2163372e";
const DEFAULT_VOTING_CONTRACT =
  "0x344848109F6181060a6801E8F5AbB0fE57CABE56";
const DEFAULT_CHAIN_ID = 11155111n;
const DEFAULT_OPTION_INDEX = 0;
const LINK_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "EVoteLink(address voter,uint256 identityCommitment,uint256 expiry,uint256 chainId,address voting)"
  )
);

function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function kv(label, value) {
  console.log(`${label.padEnd(36)} ${value}`);
}

function subkv(label, value) {
  console.log(`${(`  ${label}`).padEnd(36)} ${value}`);
}

function printList(title, values) {
  if (title) console.log(title);
  for (const value of values) {
    console.log(`  - ${value}`);
  }
}

function boolWord(value) {
  return value ? "true" : "false";
}

function hexSize(hexValue) {
  if (typeof hexValue !== "string" || !hexValue.startsWith("0x")) return "n/a";
  const hexChars = hexValue.length - 2;
  const bytes = hexChars / 2;
  return `${bytes} bytes (${hexChars} hex chars)`;
}

function decimalSize(value) {
  const big = BigInt(value);
  const bits = big === 0n ? 0 : big.toString(2).length;
  const approxBytes = Math.ceil(bits / 8);
  return `${bits} bits (~${approxBytes} bytes)`;
}

function demoCommitment(label) {
  return new Identity(`demo-${label}`).commitment;
}

function buildLinkPayloadHash(voterAddress, commitment, expiry, chainId, votingAddress) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(
    coder.encode(
      ["bytes32", "address", "uint256", "uint256", "uint256", "address"],
      [LINK_TYPEHASH, voterAddress, commitment, expiry, chainId, votingAddress]
    )
  );
}

async function generateRealProof(identity, group, voteMessage, voteScope) {
  const memberIndex = group.indexOf(identity.commitment);
  if (memberIndex === -1) {
    throw new Error("Identity commitment is not present in the group.");
  }

  const merkleProofLength = group.generateMerkleProof(memberIndex).siblings.length;
  const merkleTreeDepth = merkleProofLength === 0 ? 1 : merkleProofLength;
  const artifacts = resolveSemaphoreSnarkArtifacts(merkleTreeDepth);

  if (!artifacts) {
    throw new Error(
      "Missing local Semaphore snark artifacts. Run: pnpm run snark:fetch"
    );
  }

  return generateProof(
    identity,
    group,
    voteMessage,
    voteScope,
    merkleTreeDepth,
    artifacts
  );
}

async function main() {
  const voterPrivateKey =
    process.env.VOTER_PRIVATE_KEY || DEFAULT_VOTER_PRIVATE_KEY;
  const expectedVoterAddress =
    process.env.VOTER_ADDRESS || DEFAULT_EXPECTED_VOTER_ADDRESS;
  const votingAddress =
    process.env.VOTING_CONTRACT || DEFAULT_VOTING_CONTRACT;
  const chainId = BigInt(process.env.CHAIN_ID || DEFAULT_CHAIN_ID);
  const optionIndex = Number(process.env.OPTION_INDEX ?? DEFAULT_OPTION_INDEX);

  if (!ethers.isAddress(votingAddress)) {
    throw new Error("VOTING_CONTRACT must be a valid address");
  }

  const wallet = new ethers.Wallet(voterPrivateKey);
  const voterAddress = await wallet.getAddress();
  const iface = new ethers.Interface(votingArtifact.abi);

  // Simulated contract-side state, so the walkthrough stays offline.
  const state = {
    registered: new Map(),
    hasLinkedIdentity: new Map(),
    linkedIdentityCommitment: new Map(),
    commitmentUsed: new Map(),
    receiptUsed: new Map(),
    tallies: [0, 0, 0],
  };

  // Simulate admin registration first.
  state.registered.set(voterAddress, true);

  section("DESIGN OF THE SEMAPHORE ZK PROOFING");
  kv("Wallet private key = sk_wallet", voterPrivateKey);
  subkv("size", hexSize(voterPrivateKey));
  kv("Wallet address = addr_wallet", voterAddress);
  subkv("size", hexSize(voterAddress));
  kv("Expected address", expectedVoterAddress);
  kv("Address match?", boolWord(voterAddress === ethers.getAddress(expectedVoterAddress)));
  kv("Voting contract", votingAddress);
  subkv("pseudo", "votingContract := VOTING_CONTRACT");
  subkv("size", hexSize(votingAddress));
  kv("Chain ID", chainId.toString());

  section("ADMIN REGISTRATION (SIMULATED CONTRACT STATE)");
  kv("registered[addr_wallet]", boolWord(state.registered.get(voterAddress)));
  kv(
    "linkedIdentityCommitment[addr_wallet]",
    (state.linkedIdentityCommitment.get(voterAddress) || 0n).toString()
  );

  section("STEP 1: Derive private Semaphore identity");
  const identityMessage =
    `E-Voting ZK Identity\nContract:${votingAddress}\nVoter:${voterAddress}`;
  kv("msg", JSON.stringify(identityMessage));
  subkv(
    "pseudo",
    'msg := "E-Voting ZK Identity\\nContract:${votingContract}\\nVoter:${addr_wallet}"'
  );

  const identitySeedSignature = await wallet.signMessage(identityMessage);
  kv("sig = Sign(sk_wallet, msg)", identitySeedSignature);
  subkv("size", hexSize(identitySeedSignature));

  const identity = new Identity(identitySeedSignature);
  kv("sem_identity.privateKey", identity.privateKey.toString());
  subkv("size", hexSize(identity.privateKey.toString()));
  kv("sem_identity.secretScalar", identity.secretScalar.toString());
  subkv("size", decimalSize(identity.secretScalar));
  kv("sem_identity.publicKey", identity.publicKey.toString());
  kv("sem_commitment", identity.commitment.toString());
  subkv("size", decimalSize(identity.commitment));
  subkv("pseudo", "sem_commitment := Identity(sig).commitment");

  section("STEP 2: Link identity");
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 600);
  const linkPayloadHash = buildLinkPayloadHash(
    voterAddress,
    identity.commitment,
    expiry,
    chainId,
    votingAddress
  );
  const linkAuthorizationSignature = await wallet.signMessage(
    ethers.getBytes(linkPayloadHash)
  );
  const recoveredLinkSigner = ethers.verifyMessage(
    ethers.getBytes(linkPayloadHash),
    linkAuthorizationSignature
  );

  kv("expiry", expiry.toString());
  subkv("size", decimalSize(expiry));
  kv("linkPayloadHash(...)", linkPayloadHash);
  subkv(
    "pseudo",
    "keccak256(typehash, voter, commitment, expiry, chainId, votingContract)"
  );
  subkv("size", hexSize(linkPayloadHash));
  kv("link auth signature", linkAuthorizationSignature);
  subkv("size", hexSize(linkAuthorizationSignature));
  kv("Recovered signer", recoveredLinkSigner);
  kv("Signer matches voter?", boolWord(recoveredLinkSigner === voterAddress));

  const linkCalldata = iface.encodeFunctionData("linkIdentity", [
    voterAddress,
    identity.commitment,
    expiry,
    linkAuthorizationSignature,
  ]);
  kv("linkIdentity calldata", linkCalldata);

  // Dummy pre-existing group members so the group looks realistic.
  const groupBefore = new Group([
    demoCommitment("alpha"),
    demoCommitment("beta"),
    demoCommitment("gamma"),
    demoCommitment("delta"),
  ]);
  kv("groupSize before link", groupBefore.size.toString());
  kv("groupRoot before link", groupBefore.root.toString());
  groupBefore.members.forEach((member, i) => {
    kv(`groupBefore[${i}]`, member.toString());
  });

  // Simulate the successful on-chain write effects of linkIdentity(...).
  state.hasLinkedIdentity.set(voterAddress, true);
  state.linkedIdentityCommitment.set(voterAddress, identity.commitment);
  state.commitmentUsed.set(identity.commitment.toString(), true);

  const groupAfter = new Group(groupBefore.members);
  groupAfter.addMember(identity.commitment);

  kv(
    "linkedIdentityCommitment[addr_wallet]",
    state.linkedIdentityCommitment.get(voterAddress).toString()
  );
  kv("hasLinkedIdentity[addr_wallet]", boolWord(state.hasLinkedIdentity.get(voterAddress)));
  kv("commitmentUsed[sem_commitment]", boolWord(state.commitmentUsed.get(identity.commitment.toString())));
  kv("groupSize after link", groupAfter.size.toString());
  kv("groupRoot after link", groupAfter.root.toString());
  groupAfter.members.forEach((member, i) => {
    kv(`groupAfter[${i}]`, member.toString());
  });

  section("STEP 3: Vote");
  const receipt = ethers.hexlify(randomBytes(32));
  const voteMessage = BigInt(
    ethers.solidityPackedKeccak256(
      ["uint256", "bytes32"],
      [optionIndex, receipt]
    )
  );
  const voteScope = BigInt(
    ethers.solidityPackedKeccak256(
      ["string", "uint256", "address"],
      ["EVOTE_SCOPE", chainId, votingAddress]
    )
  );

  kv("optionIndex", optionIndex);
  kv("receipt = random()", receipt);
  subkv("size", hexSize(receipt));
  kv("voteMessage(optionIndex, receipt)", voteMessage.toString());
  subkv("pseudo", "keccak256(optionIndex, receipt)");
  subkv("size", decimalSize(voteMessage));
  kv("voteScope", voteScope.toString());
  subkv("pseudo", 'keccak256("EVOTE_SCOPE", chainId, votingContract)');
  subkv("size", decimalSize(voteScope));

  const proof = await generateRealProof(identity, groupAfter, voteMessage, voteScope);

  kv("proof.merkleTreeDepth", proof.merkleTreeDepth.toString());
  kv("proof.merkleTreeRoot", proof.merkleTreeRoot.toString());
  subkv("root size", decimalSize(proof.merkleTreeRoot));
  kv("proof.nullifier", proof.nullifier.toString());
  subkv("nullifier size", decimalSize(proof.nullifier));
  kv("proof.message", proof.message.toString());
  kv("proof.scope", proof.scope.toString());
  proof.points.forEach((point, i) => {
    kv(`proof.points[${i}]`, point.toString());
    subkv(`points[${i}] size`, decimalSize(point));
  });

  const votePayload = {
    optionIndex,
    receipt,
    proof: {
      merkleTreeDepth: proof.merkleTreeDepth.toString(),
      merkleTreeRoot: proof.merkleTreeRoot.toString(),
      nullifier: proof.nullifier.toString(),
      message: proof.message.toString(),
      scope: proof.scope.toString(),
      points: proof.points.map((p) => p.toString()),
    },
  };

  const voteCalldata = iface.encodeFunctionData("vote", [
    optionIndex,
    {
      merkleTreeDepth: BigInt(proof.merkleTreeDepth.toString()),
      merkleTreeRoot: BigInt(proof.merkleTreeRoot.toString()),
      nullifier: BigInt(proof.nullifier.toString()),
      message: BigInt(proof.message.toString()),
      scope: BigInt(proof.scope.toString()),
      points: proof.points.map((p) => BigInt(p.toString())),
    },
    receipt,
  ]);

  printList("UI sends PUBLIC payload to relayer:", [
    `optionIndex = ${votePayload.optionIndex}`,
    `receipt = ${votePayload.receipt}`,
    `proof.merkleTreeDepth = ${votePayload.proof.merkleTreeDepth}`,
    `proof.merkleTreeRoot = ${votePayload.proof.merkleTreeRoot}`,
    `proof.nullifier = ${votePayload.proof.nullifier}`,
    `proof.message = ${votePayload.proof.message}`,
    `proof.scope = ${votePayload.proof.scope}`,
    `proof.points[8] = [${votePayload.proof.points.join(", ")}]`,
  ]);
  kv("vote(...) calldata", voteCalldata);

  section("SIMULATED Voting.sol CHECKS");
  const proofMessageMatches = BigInt(proof.message.toString()) === voteMessage;
  const proofScopeMatches = BigInt(proof.scope.toString()) === voteScope;
  kv("proof.message == voteMessage", boolWord(proofMessageMatches));
  kv("proof.scope == voteScope", boolWord(proofScopeMatches));
  kv(
    "linkedIdentityCommitment[addr_wallet] != 0",
    boolWord((state.linkedIdentityCommitment.get(voterAddress) || 0n) !== 0n)
  );
  kv("receiptUsed[receipt] before", boolWord(state.receiptUsed.get(receipt)));
  kv("Semaphore proof generated", "true");

  if (!proofMessageMatches || !proofScopeMatches) {
    throw new Error("Proof did not bind correctly to the vote message or scope.");
  }

  state.receiptUsed.set(receipt, true);
  state.tallies[optionIndex] += 1;

  kv("receiptUsed[receipt] after", boolWord(state.receiptUsed.get(receipt)));
  kv("_tally", JSON.stringify(state.tallies));

  section("WHAT IS HAPPENING");
  printList("", [
    "The wallet signs an identity seed message. That signature becomes the input to Semaphore Identity(...).",
    "Semaphore derives a private identity and a public identity commitment from that signature.",
    "The public commitment is what gets linked and added to the group.",
    "The vote proof binds together: the private identity, the group, the candidate choice, the receipt, and the election scope.",
    "The contract checks that the proof matches this exact vote, then Semaphore verifies membership and one-vote-per-identity.",
  ]);
}

main().catch((err) => {
  console.error("\n[error]", err?.stack || err?.message || String(err));
  process.exit(1);
});
