const { expect } = require("chai");
const {
  REVERT,
  CANDS,
  makeReceipt,
  safeReadTally,
  openElection,
  deployElectionFixture,
  ethers,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Voting", function () {
  it("registered voter votes once; receipt stored; tally increments", async function () {
    const { voting, start, v1 } = await loadFixture(deployElectionFixture);

    await voting.registerVoters([v1.address]);
    await openElection(start);

    const receipt = makeReceipt(v1.address, 0, ethers.randomBytes(32));
    await expect(voting.connect(v1).vote(0, receipt))
      .to.emit(voting, "VoteCast")
      .withArgs(v1.address, receipt);

    expect(await voting.hasReceipt(receipt)).to.equal(true);
    const tallies = await safeReadTally(voting, CANDS.length);
    expect(tallies.map((t) => t)).to.deep.equal([1n, 0n, 0n]);

    const receipt2 = makeReceipt(v1.address, 1, ethers.randomBytes(32));
    await expect(voting.connect(v1).vote(1, receipt2)).to.be.revertedWith(
      REVERT.ALREADY_VOTED
    );
  });

  it("rejects unregistered voter", async function () {
    const { voting, start, v1 } = await loadFixture(deployElectionFixture);
    await openElection(start);

    const receipt = makeReceipt(v1.address, 0, ethers.randomBytes(32));
    await expect(voting.connect(v1).vote(0, receipt)).to.be.revertedWith(
      REVERT.NOT_REGISTERED
    );
  });

  it("rejects out-of-range candidate index at boundary", async function () {
    const { voting, start, v1 } = await loadFixture(deployElectionFixture);
    await voting.registerVoters([v1.address]);
    await openElection(start);

    const badIdx = CANDS.length;
    const receipt = makeReceipt(v1.address, badIdx, ethers.randomBytes(32));
    await expect(voting.connect(v1).vote(badIdx, receipt)).to.be.revertedWith(
      REVERT.BAD_OPTION
    );
  });
});
