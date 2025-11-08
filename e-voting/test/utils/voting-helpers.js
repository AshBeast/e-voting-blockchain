const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/* ------------ constants shared across specs ------------ */
const TITLE = "Vancouver Mayor 2026";
const CANDS = ["Alice", "Bob", "Charlie"];
const REVERT = {
  NOT_ADMIN: "not admin",
  REG_CLOSED: "registration closed",
  NOT_REGISTERED: "not registered",
  ALREADY_VOTED: "already voted",
  BAD_OPTION: "bad option",
  NOT_IN_WINDOW: "not in voting window",
  ALREADY_STARTED: "already started",
};

/* ------------------------- helpers ------------------------- */
function makeReceipt(voter, optionIndex, nonceBytes32) {
  return ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32"],
    [voter, optionIndex, nonceBytes32]
  );
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
  const [admin, v1, v2, v3, stranger] = await ethers.getSigners();

  const now = BigInt(await time.latest());
  const start = now + 60n;
  const end = start + 3600n;

  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(TITLE, CANDS, start, end);
  await voting.waitForDeployment();

  return { voting, admin, v1, v2, v3, stranger, start, end };
}

module.exports = {
  TITLE,
  CANDS,
  REVERT,
  makeReceipt,
  safeReadCandidates,
  safeReadTally,
  openElection,
  closeEdgeNudge,
  deployElectionFixture,
  time, // re-export for convenience in specs
  ethers, // re-export for convenience
};
