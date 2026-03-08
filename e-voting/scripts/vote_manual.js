// scripts/vote_manual.js
const { ethers } = require("hardhat");
const { randomBytes } = require("crypto");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("contract", {
      type: "string",
      alias: "c",
      describe: "Voting contract address",
      demandOption: true,
    })
    .option("voterPk", {
      type: "string",
      describe: "Voter private key (0x...)",
      demandOption: true,
    })
    .option("relayerPk", {
      type: "string",
      describe: "Relayer private key (0x...)",
      demandOption: true,
    })
    .option("option", {
      type: "number",
      alias: "o",
      describe: "Candidate index (0-based)",
      demandOption: true,
    })
    .option("rpc", {
      type: "string",
      alias: "r",
      describe: "RPC URL",
      default: "http://127.0.0.1:8545",
    })
    .help()
    .parse();

  const contractAddr = process.env.CONTRACT || argv.contract;
  const voterPk = process.env.VOTER_PK || argv.voterPk;
  const relayerPk = process.env.RELAYER_PK || argv.relayerPk;
  const optionIndex =
    process.env.OPTION !== undefined
      ? Number(process.env.OPTION)
      : Number(argv.option);
  const rpc = process.env.RPC || argv.rpc;

  if (!ethers.isAddress(contractAddr)) throw new Error("Bad contract address");
  if (!voterPk?.startsWith("0x") || !relayerPk?.startsWith("0x")) {
    throw new Error("VOTER_PK and RELAYER_PK must be 0x... private keys");
  }
  if (!Number.isInteger(optionIndex) || optionIndex < 0) {
    throw new Error("Bad option index");
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const voter = new ethers.Wallet(voterPk, provider);
  const relayer = new ethers.Wallet(relayerPk, provider);

  const { Identity } = await import("@semaphore-protocol/identity");
  const { Group } = await import("@semaphore-protocol/group");
  const { generateProof } = await import("@semaphore-protocol/proof");

  const voting = await ethers.getContractAt("Voting", contractAddr, provider);

  const voterAddr = await voter.getAddress();
  if (!(await voting.registered(voterAddr))) {
    throw new Error("Voter address is not registered by admin");
  }

  const idMessage = `E-Voting ZK Identity\nContract:${contractAddr}\nVoter:${voterAddr}`;
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
    console.log("✅ Identity linked");
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

  console.log("Sent tx:", tx.hash);
  await tx.wait();
  console.log("✅ Vote confirmed.");
  console.log("Voter:", voterAddr);
  console.log("Commitment:", commitment.toString());
  console.log("Receipt:", receipt);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
