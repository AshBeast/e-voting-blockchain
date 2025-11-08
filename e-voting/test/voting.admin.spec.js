const { expect } = require("chai");
const {
  REVERT,
  makeReceipt,
  openElection,
  closeEdgeNudge,
  deployElectionFixture,
  ethers,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Access Control (admin)", function () {
  it("only admin can register voters", async function () {
    const { voting, v1, v2, stranger } = await loadFixture(
      deployElectionFixture
    );

    await expect(
      voting.connect(stranger).registerVoters([v1.address, v2.address])
    ).to.be.revertedWith(REVERT.NOT_ADMIN);

    await expect(voting.registerVoters([v1.address, v2.address]))
      .to.emit(voting, "VoterRegistered")
      .withArgs(v1.address);
  });

  it("updateWindow allowed before start; blocked after start", async function () {
    const { voting, start } = await loadFixture(deployElectionFixture);

    const newStart = start + 300n;
    const newEnd = newStart + 7200n;

    await expect(voting.updateWindow(newStart, newEnd)).to.emit(
      voting,
      "ElectionConfigured"
    );

    await openElection(newStart);
    await expect(
      voting.updateWindow(newStart + 5n, newEnd + 5n)
    ).to.be.revertedWith(REVERT.ALREADY_STARTED);
  });

  it("closeEarly requires admin and closes after a 1s tick", async function () {
    const { voting, start, v1, stranger } = await loadFixture(
      deployElectionFixture
    );

    await expect(voting.connect(stranger).closeEarly()).to.be.revertedWith(
      REVERT.NOT_ADMIN
    );

    await openElection(start);
    await expect(voting.closeEarly()).to.emit(voting, "ElectionConfigured");
    await closeEdgeNudge();
    expect(await voting.status()).to.equal("CLOSED");

    const receipt = makeReceipt(v1.address, 0, ethers.randomBytes(32));
    await expect(voting.connect(v1).vote(0, receipt)).to.be.revertedWith(
      REVERT.NOT_IN_WINDOW
    );
  });

  it("closeEarly cannot be called twice", async function () {
    const { voting, start } = await loadFixture(deployElectionFixture);
    await openElection(start);
    await voting.closeEarly();
    await expect(voting.closeEarly()).to.be.reverted;
  });

  it("updateWindow sanity rejects bad ranges", async function () {
    const { voting } = await loadFixture(deployElectionFixture);
    await expect(voting.updateWindow(100n, 100n)).to.be.reverted;
    await expect(voting.updateWindow(200n, 199n)).to.be.reverted;
  });
});
