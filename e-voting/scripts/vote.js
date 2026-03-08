const { ethers } = require("hardhat");
const { randomBytes } = require("crypto");

async function main() {
  const votingAddress = process.env.CONTRACT;
  if (!ethers.isAddress(votingAddress || "")) {
    throw new Error("Set CONTRACT=0x... to your Voting contract address");
  }

  const optionIndex = Number(process.env.OPTION ?? 1);
  const voterIndex = Number(process.env.VOTER_INDEX ?? 2);
  const relayerIndex = Number(process.env.RELAYER_INDEX ?? 1);

  const signers = await ethers.getSigners();
  const voter = signers[voterIndex];
  const relayer = signers[relayerIndex];
  if (!voter || !relayer) throw new Error("Bad VOTER_INDEX or RELAYER_INDEX");

  const { Identity } = await import("@semaphore-protocol/identity");
  const { Group } = await import("@semaphore-protocol/group");
  const { generateProof } = await import("@semaphore-protocol/proof");

  const voting = await ethers.getContractAt("Voting", votingAddress);
  const voterAddr = await voter.getAddress();

  // Deterministic identity from wallet signature (same as UI flow).
  const idMessage = `E-Voting ZK Identity\nContract:${votingAddress}\nVoter:${voterAddr}`;
  const idSig = await voter.signMessage(idMessage);
  const identity = new Identity(idSig);
  const commitment = identity.commitment;

  const linked = await voting.linkedIdentityCommitment(voterAddr);
  if (linked === 0n) {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
    const payloadHash = await voting.linkPayloadHash(voterAddr, commitment, expiry);
    const linkSig = await voter.signMessage(ethers.getBytes(payloadHash));

    const linkTx = await voting
      .connect(relayer)
      .linkIdentity(voterAddr, commitment, expiry, linkSig);
    await linkTx.wait();
    console.log("Identity linked:", commitment.toString());
  }

  const logs = await voting.queryFilter(voting.filters.IdentityLinked(), 0, "latest");
  const commitments = logs.map((log) => log.args.identityCommitment);
  const group = new Group(commitments);

  const receipt = ethers.hexlify(randomBytes(32));
  const message = await voting.voteMessage(optionIndex, receipt);
  const scope = await voting.voteScope();

  const proof = await generateProof(identity, group, message, scope);

  const tx = await voting.connect(relayer).vote(
    optionIndex,
    {
      merkleTreeDepth: proof.merkleTreeDepth,
      merkleTreeRoot: proof.merkleTreeRoot,
      nullifier: proof.nullifier,
      message: proof.message,
      scope: proof.scope,
      points: proof.points,
    },
    receipt
  );

  await tx.wait();

  console.log("Relayer:", await relayer.getAddress());
  console.log("Voter:", voterAddr);
  console.log("Identity commitment:", commitment.toString());
  console.log("Voted for option index:", optionIndex);
  console.log("Receipt:", receipt);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
