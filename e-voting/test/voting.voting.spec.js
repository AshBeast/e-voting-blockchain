const { expect } = require("chai");
const {
  REVERT,
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

describe("Voting.sol – Voting", function () {
  it("linked identity votes once; receipt stored; tally increments", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
      deployElectionFixture
    );

    await voting.registerVoters([v1.address]);
    const commitment = makeIdentityCommitment(v1.address, votingAddr);
    await linkIdentity(voting, relayer, v1, commitment, start);
    await openElection(start);

    const receipt = makeReceipt(ethers.randomBytes(32));
    const root = await voting.groupRoot();
    const proof = await makeMockProof(voting, 0, receipt, root, 1001n);

    await expect(voting.connect(relayer).vote(0, proof, receipt))
      .to.emit(voting, "VoteCast")
      .withArgs(receipt);

    expect(await voting.hasReceipt(receipt)).to.equal(true);
    const tallies = await safeReadTally(voting, CANDS.length);
    expect(tallies.map((t) => t)).to.deep.equal([1n, 0n, 0n]);

    const receipt2 = makeReceipt(ethers.randomBytes(32));
    const proof2 = await makeMockProof(voting, 1, receipt2, root, 1001n);
    await expect(voting.connect(relayer).vote(1, proof2, receipt2)).to.be.reverted;
  });

  it("rejects non-relayer caller", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
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
    await openElection(start);

    const receipt = makeReceipt(ethers.randomBytes(32));
    const root = await voting.groupRoot();
    const proof = await makeMockProof(voting, 0, receipt, root, 2001n);

    await expect(voting.connect(v1).vote(0, proof, receipt)).to.be.revertedWith(
      REVERT.NOT_RELAYER
    );
  });

  it("rejects link from unregistered voter", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
      deployElectionFixture
    );

    const commitment = makeIdentityCommitment(v1.address, votingAddr);
    await expect(linkIdentity(voting, relayer, v1, commitment, start)).to.be.revertedWith(
      REVERT.NOT_REGISTERED
    );
  });

  it("rejects out-of-range candidate index at boundary", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
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
    await openElection(start);

    const badIdx = CANDS.length;
    const receipt = makeReceipt(ethers.randomBytes(32));
    const root = await voting.groupRoot();
    const proof = await makeMockProof(voting, badIdx, receipt, root, 3001n);

    await expect(voting.connect(relayer).vote(badIdx, proof, receipt)).to.be.revertedWith(
      REVERT.BAD_OPTION
    );
  });

  it("rejects mismatched proof message", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
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
    await openElection(start);

    const receipt = makeReceipt(ethers.randomBytes(32));
    const root = await voting.groupRoot();
    const proof = await makeMockProof(voting, 0, receipt, root, 4001n);
    proof.message = 123n;

    await expect(voting.connect(relayer).vote(0, proof, receipt)).to.be.revertedWith(
      "bad proof message"
    );
  });

  it("rejects relayer tampering with option index or receipt", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
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
    await openElection(start);

    const receipt = makeReceipt(ethers.randomBytes(32));
    const root = await voting.groupRoot();
    const proof = await makeMockProof(voting, 0, receipt, root, 4101n);

    // Proof binds to optionIndex + receipt. Relayer cannot alter either.
    await expect(voting.connect(relayer).vote(1, proof, receipt)).to.be.revertedWith(
      "bad proof message"
    );

    const differentReceipt = makeReceipt(ethers.randomBytes(32));
    await expect(
      voting.connect(relayer).vote(0, proof, differentReceipt)
    ).to.be.revertedWith("bad proof message");
  });

  it("rejects nullifier reuse even with a fresh receipt", async function () {
    const { voting, semaphore, votingAddr, start, relayer, v1 } = await loadFixture(
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
    await openElection(start);

    const root = await voting.groupRoot();
    const reusedNullifier = 4201n;
    const receipt1 = makeReceipt(ethers.randomBytes(32));
    const receipt2 = makeReceipt(ethers.randomBytes(32));

    const proof1 = await makeMockProof(voting, 0, receipt1, root, reusedNullifier);
    const proof2 = await makeMockProof(voting, 1, receipt2, root, reusedNullifier);

    await voting.connect(relayer).vote(0, proof1, receipt1);

    await expect(voting.connect(relayer).vote(1, proof2, receipt2)).to.be.revertedWithCustomError(
      semaphore,
      "Semaphore__YouAreUsingTheSameNullifierTwice"
    );
  });
});
