const { ethers } = require("hardhat");
const { randomBytes } = require("crypto");

async function main() {
  const addr = process.env.CONTRACT || "0x..."; // contract address from deploy
  const voting = await ethers.getContractAt("Voting", addr);

  // Use Account #1 (the first registered voter from deploy script)
  const signers = await ethers.getSigners();
  const voter = signers[1];

  const optionIndex = 1; // e.g., vote for "Bob"
  const nonce = "0x" + randomBytes(16).toString("hex"); // random nonce

  // receipt = keccak256( voter, optionIndex, nonce )
  const receipt = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes"],
      [await voter.getAddress(), optionIndex, nonce]
    )
  );

  const tx = await voting.connect(voter).vote(optionIndex, receipt);
  await tx.wait();

  console.log("Voter:", await voter.getAddress());
  console.log("Voted for option index:", optionIndex);
  console.log("Nonce:", nonce);
  console.log("Receipt:", receipt);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
