const { expect } = require("chai");
const {
  REVERT,
  makeReceipt,
  openElection,
  deployElectionFixture,
  ethers,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Registration", function () {
  it("registers voters and rejects late registration after start", async function () {
    const { voting, start, v1, v2 } = await loadFixture(deployElectionFixture);

    await expect(voting.registerVoters([v1.address, v2.address]))
      .to.emit(voting, "VoterRegistered")
      .withArgs(v1.address);

    await openElection(start);
    await expect(voting.registerVoters([v1.address])).to.be.revertedWith(
      REVERT.REG_CLOSED
    );
  });

  it("duplicate addresses in the same batch are idempotent", async function () {
    const { voting, start, v1 } = await loadFixture(deployElectionFixture);

    await voting.registerVoters([v1.address, v1.address]);
    expect(await voting.registered(v1.address)).to.equal(true);

    await openElection(start);
    const r1 = makeReceipt(v1.address, 0, ethers.randomBytes(32));
    await voting.connect(v1).vote(0, r1);

    const r2 = makeReceipt(v1.address, 1, ethers.randomBytes(32));
    await expect(voting.connect(v1).vote(1, r2)).to.be.revertedWith(
      REVERT.ALREADY_VOTED
    );
  });
});
