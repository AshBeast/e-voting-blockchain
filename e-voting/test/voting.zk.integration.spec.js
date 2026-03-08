const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const {
  CANDS,
  makeReceipt,
  openElection,
  safeReadTally,
  time,
  ethers,
} = require("./utils/voting-helpers");
const { resolveSemaphoreSnarkArtifacts } = require("./utils/snark-artifacts");

async function deployRealSemaphoreElectionFixture() {
  const [admin, relayer, v1] = await ethers.getSigners();

  const now = BigInt(await time.latest());
  const start = now + 60n;
  const end = start + 3600n;

  const Verifier = await ethers.getContractFactory("LocalSemaphoreVerifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const PoseidonT3 = await ethers.getContractFactory("PoseidonT3");
  const poseidonT3 = await PoseidonT3.deploy();
  await poseidonT3.waitForDeployment();

  const Semaphore = await ethers.getContractFactory("LocalSemaphore", {
    libraries: {
      PoseidonT3: await poseidonT3.getAddress(),
    },
  });
  const semaphore = await Semaphore.deploy(await verifier.getAddress());
  await semaphore.waitForDeployment();

  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(
    "Real ZK Election",
    CANDS,
    start,
    end,
    relayer.address,
    await semaphore.getAddress()
  );
  await voting.waitForDeployment();

  return { voting, relayer, v1, start };
}

describe("Voting.sol – Real Semaphore integration", function () {
  it("accepts a real Semaphore proof and rejects tampered option index", async function () {
    const { Identity } = await import("@semaphore-protocol/identity");
    const { Group } = await import("@semaphore-protocol/group");
    const { generateProof } = await import("@semaphore-protocol/proof");

    const { voting, relayer, v1, start } = await loadFixture(
      deployRealSemaphoreElectionFixture
    );
    const votingAddress = await voting.getAddress();
    const voterAddress = await v1.getAddress();

    await voting.registerVoters([voterAddress]);

    const idMessage = `E-Voting ZK Identity\nContract:${votingAddress}\nVoter:${voterAddress}`;
    const idSig = await v1.signMessage(idMessage);
    const identity = new Identity(idSig);
    const commitment = BigInt(identity.commitment.toString());

    const expiry = start;
    const payloadHash = await voting.linkPayloadHash(voterAddress, commitment, expiry);
    const linkSig = await v1.signMessage(ethers.getBytes(payloadHash));
    await voting.connect(relayer).linkIdentity(voterAddress, commitment, expiry, linkSig);

    await openElection(start);

    const logs = await voting.queryFilter(voting.filters.IdentityLinked(), 0, "latest");
    const members = logs.map((log) => BigInt(log.args.identityCommitment.toString()));
    const group = new Group(members);

    const optionIndex = 1;
    const receipt = makeReceipt(ethers.randomBytes(32));
    const message = await voting.voteMessage(optionIndex, receipt);
    const scope = await voting.voteScope();
    const memberIndex = group.indexOf(identity.commitment);
    const merkleProofLength = group.generateMerkleProof(memberIndex).siblings.length;
    const merkleTreeDepth = merkleProofLength === 0 ? 1 : merkleProofLength;
    const localArtifacts = resolveSemaphoreSnarkArtifacts(merkleTreeDepth);

    let realProof;
    try {
      if (localArtifacts) {
        realProof = await generateProof(
          identity,
          group,
          message,
          scope,
          merkleTreeDepth,
          localArtifacts
        );
      } else {
        realProof = await generateProof(identity, group, message, scope);
      }
    } catch (err) {
      const text = err?.stack || err?.message || String(err);
      if (text.includes("snark-artifacts.pse.dev") || text.includes("fetch failed")) {
        this.skip();
        return;
      }
      throw err;
    }
    const formattedProof = {
      merkleTreeDepth: BigInt(realProof.merkleTreeDepth.toString()),
      merkleTreeRoot: BigInt(realProof.merkleTreeRoot.toString()),
      nullifier: BigInt(realProof.nullifier.toString()),
      message: BigInt(realProof.message.toString()),
      scope: BigInt(realProof.scope.toString()),
      points: realProof.points.map((p) => BigInt(p.toString())),
    };

    await expect(voting.connect(relayer).vote(0, formattedProof, receipt)).to.be.revertedWith(
      "bad proof message"
    );

    await expect(voting.connect(relayer).vote(optionIndex, formattedProof, receipt))
      .to.emit(voting, "VoteCast")
      .withArgs(receipt);

    const tallies = await safeReadTally(voting, CANDS.length);
    expect(tallies.map((t) => t)).to.deep.equal([0n, 1n, 0n]);
  });
});
