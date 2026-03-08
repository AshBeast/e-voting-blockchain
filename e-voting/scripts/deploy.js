const { ethers } = require("hardhat");

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const start = now + 10;
  const end = now + 120;

  const signers = await ethers.getSigners();
  const relayer = signers[1];

  const Verifier = await ethers.getContractFactory(
    "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol:SemaphoreVerifier"
  );
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const Semaphore = await ethers.getContractFactory(
    "@semaphore-protocol/contracts/Semaphore.sol:Semaphore"
  );
  const semaphore = await Semaphore.deploy(await verifier.getAddress());
  await semaphore.waitForDeployment();

  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(
    "Vancouver Mayor 2026",
    ["Rebecca Bligh", "Kareem Allam", "Ken Sim"],
    start,
    end,
    relayer.address,
    await semaphore.getAddress()
  );
  await voting.waitForDeployment();

  const addr = await voting.getAddress();
  console.log("Voting deployed to:", addr);
  console.log("Relayer:", relayer.address);
  console.log("Semaphore:", await semaphore.getAddress());
  console.log("SemaphoreVerifier:", await verifier.getAddress());
  console.log("Semaphore Group ID:", (await voting.semaphoreGroupId()).toString());

  // Register the first 10 voter addresses (admin allowlist).
  const voterAddrs = signers.slice(2, 12).map((s) => s.address);
  const tx = await voting.registerVoters(voterAddrs);
  await tx.wait();
  console.log(`Registered ${voterAddrs.length} eligible voters.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
