const { expect } = require("chai");
const {
  REVERT,
  makeIdentityCommitment,
  makeLinkSignature,
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

  it("rejects identity linking after election start", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
      deployElectionFixture
    );

    await voting.registerVoters([v1.address]);
    await openElection(start);

    const commitment = makeIdentityCommitment(v1.address, votingAddr);
    const expiry = start + 3600n;
    const sig = await makeLinkSignature(voting, v1, commitment, expiry);

    await expect(
      voting.connect(relayer).linkIdentity(v1.address, commitment, expiry, sig)
    ).to.be.revertedWith(REVERT.LINK_CLOSED);
  });

  it("duplicate addresses in the same batch are idempotent", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
      deployElectionFixture
    );

    await voting.registerVoters([v1.address, v1.address]);
    expect(await voting.registered(v1.address)).to.equal(true);

    const commitment = makeIdentityCommitment(v1.address, votingAddr);
    const expiry = start;
    const sig1 = await makeLinkSignature(voting, v1, commitment, expiry);
    await voting
      .connect(relayer)
      .linkIdentity(v1.address, commitment, expiry, sig1);

    const anotherCommitment = BigInt(
      ethers.solidityPackedKeccak256(
        ["string", "address", "address"],
        ["EVOTE_TEST_IDENTITY_2", v1.address, votingAddr]
      )
    );
    const sig2 = await makeLinkSignature(voting, v1, anotherCommitment, expiry);

    await expect(
      voting
        .connect(relayer)
        .linkIdentity(v1.address, anotherCommitment, expiry, sig2)
    ).to.be.revertedWith(REVERT.IDENTITY_LINKED);
  });

  it("rejects replaying the same link signature on the same election", async function () {
    const { voting, votingAddr, start, relayer, v1 } = await loadFixture(
      deployElectionFixture
    );

    await voting.registerVoters([v1.address]);
    const commitment = makeIdentityCommitment(v1.address, votingAddr);
    const sig = await makeLinkSignature(voting, v1, commitment, start);

    await voting.connect(relayer).linkIdentity(v1.address, commitment, start, sig);

    await expect(
      voting.connect(relayer).linkIdentity(v1.address, commitment, start, sig)
    ).to.be.revertedWith(REVERT.IDENTITY_LINKED);
  });

  it("rejects replaying a link signature across elections", async function () {
    const { voting, relayer, v1, start, end } = await loadFixture(deployElectionFixture);
    const votingAddrA = await voting.getAddress();

    const MockSemaphore = await ethers.getContractFactory("MockSemaphore");
    const semaphoreB = await MockSemaphore.deploy();
    await semaphoreB.waitForDeployment();

    const Voting = await ethers.getContractFactory("Voting");
    const votingB = await Voting.deploy(
      "Second Election",
      ["A", "B"],
      start,
      end,
      relayer.address,
      await semaphoreB.getAddress()
    );
    await votingB.waitForDeployment();

    await voting.registerVoters([v1.address]);
    await votingB.registerVoters([v1.address]);

    const commitment = makeIdentityCommitment(v1.address, votingAddrA);
    const sigFromElectionA = await makeLinkSignature(voting, v1, commitment, start);

    await expect(
      votingB
        .connect(relayer)
        .linkIdentity(v1.address, commitment, start, sigFromElectionA)
    ).to.be.revertedWith("bad link signature");
  });
});
