const { expect } = require("chai");
const {
  TITLE,
  CANDS,
  safeReadCandidates,
  deployElectionFixture,
  time,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Deployment & Configuration", function () {
  it("stores title, candidates, start/end, and initial status", async function () {
    const { voting, start, end } = await loadFixture(deployElectionFixture);

    const [storedTitle, storedStart, storedEnd] = await voting.electionInfo();
    expect(storedTitle).to.equal(TITLE);
    expect(storedStart).to.equal(start);
    expect(storedEnd).to.equal(end);

    expect(await voting.candidateCount()).to.equal(BigInt(CANDS.length));
    const names = await safeReadCandidates(voting);
    expect(names).to.deep.equal(CANDS);

    expect(await voting.status()).to.equal("PENDING");
  });
});
