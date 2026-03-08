const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/* ------------ constants shared across specs ------------ */
const TITLE = "Vancouver Mayor 2026";
const CANDS = ["Alice", "Bob", "Charlie"];
const REVERT = {
  NOT_ADMIN: "not admin",
  NOT_RELAYER: "not relayer",
  REG_CLOSED: "registration closed",
  NOT_REGISTERED: "not registered",
  ALREADY_VOTED: "already voted",
  IDENTITY_LINKED: "identity linked",
  BAD_OPTION: "bad option",
  NOT_IN_WINDOW: "not in voting window",
  ALREADY_STARTED: "already started",
  RECEIPT_USED: "receipt used",
};

/* ------------------------- helpers ------------------------- */
function makeReceipt(nonceBytes32) {
  return ethers.solidityPackedKeccak256(["bytes32"], [nonceBytes32]);
}

function makeIdentityCommitment(voterAddress, votingAddress) {
  return BigInt(
    ethers.solidityPackedKeccak256(
      ["string", "address", "address"],
      ["EVOTE_TEST_IDENTITY", voterAddress, votingAddress]
    )
  );
}

async function makeLinkSignature(voting, voter, commitment, expiry) {
  const payloadHash = await voting.linkPayloadHash(voter.address, commitment, expiry);
  return voter.signMessage(ethers.getBytes(payloadHash));
}

async function makeMockProof(voting, optionIndex, receipt, root, nullifier) {
  const depth = await voting.groupDepth();
  const message = await voting.voteMessage(optionIndex, receipt);
  const scope = await voting.voteScope();

  return {
    merkleTreeDepth: depth,
    merkleTreeRoot: root,
    nullifier,
    message,
    scope,
    points: [1, 0, 0, 0, 0, 0, 0, 0],
  };
}

async function linkIdentity(voting, relayer, voter, commitment, expiry) {
  const sig = await makeLinkSignature(voting, voter, commitment, expiry);
  return voting
    .connect(relayer)
    .linkIdentity(voter.address, commitment, expiry, sig);
}

async function safeReadCandidates(voting) {
  try {
    return await voting.getCandidates();
  } catch {}
  try {
    return await voting.candidates();
  } catch {}
  const n = await voting.candidateCount();
  const names = [];
  try {
    for (let i = 0n; i < n; i++) names.push(await voting.candidates(i));
    return names;
  } catch {}
  for (let i = 0n; i < n; i++) names.push(await voting.candidateAt(i));
  return names;
}

async function safeReadTally(voting, expectedLen) {
  try {
    return await voting.tally(); // uint256[]
  } catch {
    const arr = [];
    for (let i = 0; i < expectedLen; i++) {
      arr.push(await voting.tally(i)); // fallback if exposed as public array
    }
    return arr;
  }
}

async function openElection(start) {
  await time.increaseTo(Number(start + 1n));
}
async function closeEdgeNudge() {
  await time.increase(1);
}

/* ------------------------- fixture ------------------------- */
async function deployElectionFixture() {
  const [admin, relayer, v1, v2, v3, stranger] = await ethers.getSigners();

  const now = BigInt(await time.latest());
  const start = now + 60n;
  const end = start + 3600n;

  const MockSemaphore = await ethers.getContractFactory("MockSemaphore");
  const semaphore = await MockSemaphore.deploy();
  await semaphore.waitForDeployment();

  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(
    TITLE,
    CANDS,
    start,
    end,
    relayer.address,
    await semaphore.getAddress()
  );
  await voting.waitForDeployment();

  const votingAddr = await voting.getAddress();
  return {
    semaphore,
    voting,
    votingAddr,
    admin,
    relayer,
    v1,
    v2,
    v3,
    stranger,
    start,
    end,
  };
}

module.exports = {
  TITLE,
  CANDS,
  REVERT,
  makeReceipt,
  makeIdentityCommitment,
  makeLinkSignature,
  makeMockProof,
  linkIdentity,
  safeReadCandidates,
  safeReadTally,
  openElection,
  closeEdgeNudge,
  deployElectionFixture,
  time, // re-export for convenience in specs
  ethers, // re-export for convenience
};
