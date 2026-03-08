const { expect } = require("chai");
const {
  REVERT,
  makeReceipt,
  makeIdentityCommitment,
  makeMockProof,
  linkIdentity,
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
    const { voting, votingAddr, start, end, relayer, v1 } = await loadFixture(
      deployElectionFixture
    );

    await voting.registerVoters([v1.address]);
    await linkIdentity(
      voting,
      relayer,
      v1,
      makeIdentityCommitment(v1.address, votingAddr),
      start
    );

    const r0 = makeReceipt(ethers.randomBytes(32));
    const root = await voting.groupRoot();
    const p0 = await makeMockProof(voting, 0, r0, root, 6001n);
    await expect(voting.connect(relayer).vote(0, p0, r0)).to.be.revertedWith(
      REVERT.NOT_IN_WINDOW
    );

    await openElection(start);
    const r1 = makeReceipt(ethers.randomBytes(32));
    const p1 = await makeMockProof(voting, 0, r1, root, 6002n);
    await voting.connect(relayer).vote(0, p1, r1);

    await time.increaseTo(Number(end + 1n));
    const r2 = makeReceipt(ethers.randomBytes(32));
    const p2 = await makeMockProof(voting, 0, r2, root, 6003n);
    await expect(voting.connect(relayer).vote(0, p2, r2)).to.be.revertedWith(
      REVERT.NOT_IN_WINDOW
    );
  });
});
