const { expect } = require("chai");
const {
  CANDS,
  makeReceipt,
  makeIdentityCommitment,
  makeMockProof,
  linkIdentity,
  safeReadTally,
  openElection,
  deployElectionFixture,
  ethers,
} = require("./utils/voting-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting.sol – Tally", function () {
  it("reflects sum across many voters (5 for A, 3 for B)", async function () {
    const { voting, votingAddr, start, relayer } = await loadFixture(
      deployElectionFixture
    );
    const signers = await ethers.getSigners();
    const voters = signers.slice(5, 13); // 8 voters

    await voting.registerVoters(voters.map((v) => v.address));
    for (const voter of voters) {
      const commitment = makeIdentityCommitment(voter.address, votingAddr);
      await linkIdentity(voting, relayer, voter, commitment, start);
    }

    await openElection(start);
    const root = await voting.groupRoot();

    for (let i = 0; i < 5; i++) {
      const receipt = makeReceipt(ethers.randomBytes(32));
      const proof = await makeMockProof(voting, 0, receipt, root, BigInt(7000 + i));
      await voting.connect(relayer).vote(0, proof, receipt);
    }

    for (let i = 5; i < 8; i++) {
      const receipt = makeReceipt(ethers.randomBytes(32));
      const proof = await makeMockProof(voting, 1, receipt, root, BigInt(7000 + i));
      await voting.connect(relayer).vote(1, proof, receipt);
    }

    const tallies = await safeReadTally(voting, CANDS.length);
    expect(tallies.map((x) => x)).to.deep.equal([5n, 3n, 0n]);
  });
});
