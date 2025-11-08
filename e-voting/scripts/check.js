const { ethers } = require("hardhat");

async function main() {
  // Get contract address from environment variable
  const contractAddr = process.env.CONTRACT;
  if (!contractAddr) throw new Error("Missing CONTRACT env var. Example:\nCONTRACT=0x... npx hardhat run scripts/check.js --network localhost");

  const Voting = await ethers.getContractFactory("Voting");
  const voting = Voting.attach(contractAddr);

  console.log(`🔍 Reading from Voting contract at: ${contractAddr}`);

  // Fetch candidate list
  const names = await voting.candidates();
  const tally = await voting.tally();

  console.log("\n🗳️ Current Results:");
  names.forEach((name, i) => {
    console.log(`  ${name}: ${tally[i].toString()} votes`);
  });

  // Optional: check a receipt hash (for example)
  const receiptToCheck = process.env.RECEIPT; // e.g. RECEIPT=0x123...
  if (receiptToCheck) {
    const used = await voting.hasReceipt(receiptToCheck);
    console.log(`\n🔐 Receipt ${receiptToCheck} used? ${used}`);
  } else {
    console.log("\n(No receipt provided; skipping check)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
