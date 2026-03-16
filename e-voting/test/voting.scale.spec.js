const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  CANDS,
  makeIdentityCommitment,
  makeLinkSignature,
  makeMockProof,
  makeReceipt,
  openElection,
  safeReadTally,
} = require("./utils/voting-helpers");
const { resolveSemaphoreSnarkArtifacts } = require("./utils/snark-artifacts");

const RUN_SCALE = process.env.SCALE_BENCH === "1";
const DEFAULT_TOTAL_VOTERS = 1000;
const DEFAULT_BATCH_SIZE = 250;
const BLOCK_GAS_LIMIT = 30_000_000;
const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return n;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function makeBenchWallets(count, seedPrefix) {
  return Array.from({ length: count }, (_, i) => {
    const privateKey = ethers.keccak256(
      ethers.toUtf8Bytes(`${seedPrefix}:${i}`)
    );
    return new ethers.Wallet(privateKey);
  });
}

function makeFieldSafeCommitment(voterAddress, votingAddress) {
  const raw = BigInt(
    ethers.solidityPackedKeccak256(
      ["string", "address", "address"],
      ["EVOTE_SCALE_IDENTITY", voterAddress, votingAddress]
    )
  );
  return (raw % (SNARK_SCALAR_FIELD - 1n)) + 1n;
}

function metricRow({
  phase,
  entities,
  txCount,
  totalGas,
  elapsedMs,
  extra = {},
}) {
  const gasNumber = Number(totalGas);
  const elapsedSeconds = elapsedMs / 1000;
  return {
    phase,
    entities,
    txCount,
    totalGas: gasNumber,
    avgGasPerTx: txCount > 0 ? Math.round(gasNumber / txCount) : 0,
    avgGasPerEntity: entities > 0 ? Math.round(gasNumber / entities) : 0,
    throughputPerSec:
      elapsedSeconds > 0 ? Number((entities / elapsedSeconds).toFixed(2)) : 0,
    elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
    ...extra,
  };
}

async function deployMockElection(startLeadSeconds = 86400n) {
  const [admin, relayer] = await ethers.getSigners();
  const now = BigInt(await time.latest());
  const start = now + startLeadSeconds;
  const end = start + 86400n;

  const MockSemaphore = await ethers.getContractFactory("MockSemaphore");
  const semaphore = await MockSemaphore.deploy();
  await semaphore.waitForDeployment();

  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(
    "Scale Benchmark Election (Mock)",
    CANDS,
    start,
    end,
    relayer.address,
    await semaphore.getAddress()
  );
  await voting.waitForDeployment();

  return { admin, relayer, semaphore, voting, votingAddr: await voting.getAddress(), start, end };
}

async function deployRealSemaphoreElection(startLeadSeconds = 86400n) {
  const [admin, relayer] = await ethers.getSigners();
  const now = BigInt(await time.latest());
  const start = now + startLeadSeconds;
  const end = start + 86400n;

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
    "Scale Benchmark Election (Real Semaphore)",
    CANDS,
    start,
    end,
    relayer.address,
    await semaphore.getAddress()
  );
  await voting.waitForDeployment();

  return { admin, relayer, semaphore, voting, votingAddr: await voting.getAddress(), start, end };
}

(RUN_SCALE ? describe : describe.skip)("Voting.sol – Scale Benchmarks", function () {
  const totalVoters = envInt("SCALE_VOTERS", DEFAULT_TOTAL_VOTERS);
  const batchSize = Math.max(1, envInt("SCALE_BATCH_SIZE", DEFAULT_BATCH_SIZE));
  const linkVoters = clamp(
    envInt("SCALE_LINK_VOTERS", totalVoters),
    0,
    totalVoters
  );
  const voteVoters = clamp(
    envInt("SCALE_VOTE_VOTERS", linkVoters),
    0,
    linkVoters
  );
  const approxTxCount =
    Math.ceil(totalVoters / batchSize) + linkVoters + voteVoters + 20;

  this.timeout(Math.max(300_000, approxTxCount * 75));

  it("benchmarks large-scale registration, linking, and voting", async function () {
    const summary = [];
    const wallets = makeBenchWallets(totalVoters, "scale-bench-voter");
    const addresses = wallets.map((w) => w.address);

    const {
      voting: registrationVoting,
    } = await deployMockElection();

    let registerTotalGas = 0n;
    let maxRegisterBatchGas = 0n;
    const registerStarted = Date.now();
    for (const batch of chunk(addresses, batchSize)) {
      const tx = await registrationVoting.registerVoters(batch);
      const rcpt = await tx.wait();
      registerTotalGas += rcpt.gasUsed;
      if (rcpt.gasUsed > maxRegisterBatchGas) {
        maxRegisterBatchGas = rcpt.gasUsed;
      }
    }
    const registerElapsed = Date.now() - registerStarted;

    expect(await registrationVoting.registered(addresses[0])).to.equal(true);
    expect(await registrationVoting.registered(addresses[addresses.length - 1])).to.equal(true);
    expect(Number(maxRegisterBatchGas)).to.be.lessThan(BLOCK_GAS_LIMIT);

    summary.push(
      metricRow({
        phase: "register-large-allowlist",
        entities: totalVoters,
        txCount: Math.ceil(totalVoters / batchSize),
        totalGas: registerTotalGas,
        elapsedMs: registerElapsed,
        extra: {
          batchSize,
          maxBatchGas: Number(maxRegisterBatchGas),
        },
      })
    );

    const linkWallets = wallets.slice(0, linkVoters);
    const {
      voting: linkVoting,
      votingAddr: linkVotingAddr,
      relayer: linkRelayer,
      start: linkStart,
    } = await deployRealSemaphoreElection();

    for (const batch of chunk(linkWallets.map((w) => w.address), batchSize)) {
      await (await linkVoting.registerVoters(batch)).wait();
    }

    let linkTotalGas = 0n;
    const linkStarted = Date.now();
    for (const wallet of linkWallets) {
      const fieldSafeCommitment = makeFieldSafeCommitment(
        wallet.address,
        linkVotingAddr
      );
      const sig = await makeLinkSignature(
        linkVoting,
        wallet,
        fieldSafeCommitment,
        linkStart
      );
      const tx = await linkVoting
        .connect(linkRelayer)
        .linkIdentity(wallet.address, fieldSafeCommitment, linkStart, sig);
      const rcpt = await tx.wait();
      linkTotalGas += rcpt.gasUsed;
    }
    const linkElapsed = Date.now() - linkStarted;

    expect(Number(await linkVoting.groupSize())).to.equal(linkVoters);

    summary.push(
      metricRow({
        phase: "linkIdentity-real-semaphore",
        entities: linkVoters,
        txCount: linkVoters,
        totalGas: linkTotalGas,
        elapsedMs: linkElapsed,
        extra: {
          note: "real Semaphore tree insertion",
        },
      })
    );

    const voteWallets = wallets.slice(0, voteVoters);
    const {
      voting: voteVoting,
      votingAddr: voteVotingAddr,
      relayer: voteRelayer,
      start: voteStart,
    } = await deployMockElection();

    for (const batch of chunk(voteWallets.map((w) => w.address), batchSize)) {
      await (await voteVoting.registerVoters(batch)).wait();
    }

    for (const wallet of voteWallets) {
      const commitment = makeIdentityCommitment(wallet.address, voteVotingAddr);
      const sig = await makeLinkSignature(voteVoting, wallet, commitment, voteStart);
      await voteVoting
        .connect(voteRelayer)
        .linkIdentity(wallet.address, commitment, voteStart, sig);
    }

    await openElection(voteStart);

    const root = await voteVoting.groupRoot();
    let voteTotalGas = 0n;
    const voteStarted = Date.now();
    for (let i = 0; i < voteWallets.length; i++) {
      const optionIndex = i % CANDS.length;
      const receipt = makeReceipt(ethers.randomBytes(32));
      const proof = await makeMockProof(
        voteVoting,
        optionIndex,
        receipt,
        root,
        BigInt(1_000_000 + i)
      );

      const tx = await voteVoting.connect(voteRelayer).vote(optionIndex, proof, receipt);
      const rcpt = await tx.wait();
      voteTotalGas += rcpt.gasUsed;
    }
    const voteElapsed = Date.now() - voteStarted;

    const tallies = await safeReadTally(voteVoting, CANDS.length);
    const tallyTotal = tallies.reduce((sum, value) => sum + Number(value), 0);
    expect(tallyTotal).to.equal(voteVoters);

    const avgVoteGas = voteVoters > 0 ? Number(voteTotalGas) / voteVoters : 0;
    summary.push(
      metricRow({
        phase: "vote-mock-verifier",
        entities: voteVoters,
        txCount: voteVoters,
        totalGas: voteTotalGas,
        elapsedMs: voteElapsed,
        extra: {
          approxVotesPer30MGasBlock:
            avgVoteGas > 0 ? Math.floor(BLOCK_GAS_LIMIT / avgVoteGas) : 0,
          note: "mock verifier, good for throughput not real proof cost",
        },
      })
    );

    console.log("\nScale benchmark config");
    console.table([
      {
        totalVoters,
        batchSize,
        linkVoters,
        voteVoters,
        blockGasLimit: BLOCK_GAS_LIMIT,
      },
    ]);
    console.log("\nScale benchmark summary");
    console.table(summary);
  });

  it("captures a real Semaphore single-vote gas baseline", async function () {
    const { Identity } = await import("@semaphore-protocol/identity");
    const { Group } = await import("@semaphore-protocol/group");
    const { generateProof } = await import("@semaphore-protocol/proof");

    const { voting, relayer, start, votingAddr } = await deployRealSemaphoreElection();
    const wallet = makeBenchWallets(1, "scale-bench-real-proof")[0];

    await voting.registerVoters([wallet.address]);
    const idMessage = `E-Voting ZK Identity\nContract:${votingAddr}\nVoter:${wallet.address}`;
    const identity = new Identity(await wallet.signMessage(idMessage));
    const commitment = BigInt(identity.commitment.toString());
    const linkSig = await makeLinkSignature(voting, wallet, commitment, start);

    await voting
      .connect(relayer)
      .linkIdentity(wallet.address, commitment, start, linkSig);

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

    const voteStarted = Date.now();
    const tx = await voting.connect(relayer).vote(optionIndex, formattedProof, receipt);
    const rcpt = await tx.wait();
    const voteElapsed = Date.now() - voteStarted;

    console.log("\nReal proof vote baseline");
    console.table([
      metricRow({
        phase: "vote-real-proof-baseline",
        entities: 1,
        txCount: 1,
        totalGas: rcpt.gasUsed,
        elapsedMs: voteElapsed,
        extra: {
          projected1kVotesGas: Number(rcpt.gasUsed) * 1000,
          projected10kVotesGas: Number(rcpt.gasUsed) * 10000,
        },
      }),
    ]);
  });
});
