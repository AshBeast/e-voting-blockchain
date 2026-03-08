const { expect } = require("chai");
const {
  makeReceipt,
  makeIdentityCommitment,
  makeMockProof,
  linkIdentity,
  openElection,
  deployElectionFixture,
  ethers,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Receipts (inclusion & replay-protection)", function () {
  it("records inclusion and prevents receipt replay", async function () {
    const { voting, votingAddr, start, relayer, v1, v2 } = await loadFixture(
      deployElectionFixture
    );

    await voting.registerVoters([v1.address, v2.address]);
    await linkIdentity(
      voting,
      relayer,
      v1,
      makeIdentityCommitment(v1.address, votingAddr),
      start
    );
    await linkIdentity(
      voting,
      relayer,
      v2,
      makeIdentityCommitment(v2.address, votingAddr),
      start
    );
    await openElection(start);

    const shared = makeReceipt(ethers.randomBytes(32));
    const root = await voting.groupRoot();

    const p1 = await makeMockProof(voting, 0, shared, root, 5001n);
    await voting.connect(relayer).vote(0, p1, shared);
    expect(await voting.hasReceipt(shared)).to.equal(true);

    const p2 = await makeMockProof(voting, 1, shared, root, 5002n);
    await expect(voting.connect(relayer).vote(1, p2, shared)).to.be.revertedWith(
      "receipt used"
    );
  });
});
