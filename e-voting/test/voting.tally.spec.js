const { expect } = require("chai");
const {
  CANDS,
  makeReceipt,
  safeReadTally,
  openElection,
  deployElectionFixture,
  ethers,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Tally", function () {
  it("reflects sum across many voters (5 for A, 3 for B)", async function () {
    const { voting, start } = await loadFixture(deployElectionFixture);
    const signers = await ethers.getSigners();
    const voters = signers.slice(5, 13); // 8 voters

    await voting.registerVoters(voters.map((v) => v.address));
    await openElection(start);

    for (let i = 0; i < 5; i++) {
      const v = voters[i];
      const r = makeReceipt(v.address, 0, ethers.randomBytes(32));
      await voting.connect(v).vote(0, r);
    }
    for (let i = 5; i < 8; i++) {
      const v = voters[i];
      const r = makeReceipt(v.address, 1, ethers.randomBytes(32));
      await voting.connect(v).vote(1, r);
    }

    const tallies = await safeReadTally(voting, CANDS.length);
    expect(tallies.map((x) => x)).to.deep.equal([5n, 3n, 0n]);
  });
});
