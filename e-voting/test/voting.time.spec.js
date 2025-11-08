const { expect } = require("chai");
const {
  REVERT,
  makeReceipt,
  openElection,
  deployElectionFixture,
  time,
  ethers,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Time Window", function () {
  it("status transitions PENDING → OPEN → CLOSED", async function () {
    const { voting, start, end } = await loadFixture(deployElectionFixture);

    expect(await voting.status()).to.equal("PENDING");
    await time.increaseTo(Number(start));
    expect(await voting.status()).to.equal("OPEN");
    await time.increaseTo(Number(end + 1n));
    expect(await voting.status()).to.equal("CLOSED");
  });

  it("rejects votes before start and after end; allows during window", async function () {
    const { voting, start, end, v1 } = await loadFixture(deployElectionFixture);
    await voting.registerVoters([v1.address]);

    const r0 = makeReceipt(v1.address, 0, ethers.randomBytes(32));
    await expect(voting.connect(v1).vote(0, r0)).to.be.revertedWith(
      REVERT.NOT_IN_WINDOW
    );

    await openElection(start);
    const r1 = makeReceipt(v1.address, 0, ethers.randomBytes(32));
    await voting.connect(v1).vote(0, r1);

    await time.increaseTo(Number(end + 1n));
    const r2 = makeReceipt(v1.address, 0, ethers.randomBytes(32));
    await expect(voting.connect(v1).vote(0, r2)).to.be.revertedWith(
      REVERT.NOT_IN_WINDOW
    );
  });
});
