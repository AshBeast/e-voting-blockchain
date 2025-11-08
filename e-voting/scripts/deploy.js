// scripts/deploy_and_register.js
const { ethers } = require("hardhat");
const { network } = require("hardhat");

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const start = now + 10;
  //   const end = now + 24 * 3600; // ends in 24h
  const end = now + 120;

  const Voting = await ethers.getContractFactory("Voting");
  const voting = await Voting.deploy(
    "Vancouver Mayor 2026",
    ["Rebecca Bligh", "Kareem Allam", "Ken Sim"],
    start,
    end
  );
  await voting.waitForDeployment();
  const addr = await voting.getAddress();
  console.log("Voting deployed to:", addr);

  // register the first 20 signers (Hardhat provides 20 accounts)
  const signers = await ethers.getSigners();
  const addrs = signers.slice(0, 20).map((s) => s.address);

  const tx = await voting.registerVoters(addrs);
  await tx.wait();
  console.log("Registered voters:");
  addrs.forEach((a) => console.log(" ", a));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
