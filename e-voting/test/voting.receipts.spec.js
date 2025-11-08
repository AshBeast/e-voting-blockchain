const { expect } = require("chai");
const {
  makeReceipt,
  openElection,
  deployElectionFixture,
  ethers,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Receipts (inclusion & replay-protection)", function () {
  it("records inclusion and prevents replay across accounts", async function () {
    const { voting, start, v1, v2 } = await loadFixture(deployElectionFixture);

    await voting.registerVoters([v1.address, v2.address]);
    await openElection(start);

    const nonce = ethers.randomBytes(32);
    const shared = makeReceipt(v1.address, 0, nonce);

    await voting.connect(v1).vote(0, shared);
    expect(await voting.hasReceipt(shared)).to.equal(true);

    await expect(voting.connect(v2).vote(1, shared)).to.be.revertedWith(
      "receipt used"
    );
  });
});
