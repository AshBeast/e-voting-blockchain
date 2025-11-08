const { ethers } = require("hardhat");
async function main() {
  const net = await ethers.provider.getNetwork();
  const [signer] = await ethers.getSigners();
  const addr = await signer.getAddress();
  const bal = await ethers.provider.getBalance(addr);
  console.log("Network:", net.name, net.chainId);
  console.log("Signer:", addr);
  console.log("Balance (ETH):", ethers.formatEther(bal));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
