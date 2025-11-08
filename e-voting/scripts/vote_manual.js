// scripts/vote_manual.js
const { ethers } = require("hardhat");
const { randomBytes } = require("crypto");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

async function main() {
  // Parse CLI flags (optional)
  const argv = yargs(hideBin(process.argv))
    .option("contract", {
      type: "string",
      alias: "c",
      describe: "Voting contract address",
    })
    .option("pk", {
      type: "string",
      alias: "k",
      describe: "Private key of voter (0x...)",
    })
    .option("mnemonic", {
      type: "string",
      alias: "m",
      describe: "BIP39 mnemonic (alternative to pk)",
    })
    .option("option", {
      type: "number",
      alias: "o",
      describe: "Candidate index (0-based)",
    })
    .option("nonce", {
      type: "string",
      alias: "n",
      describe: "Optional nonce (hex). Random if omitted",
    })
    .option("rpc", {
      type: "string",
      alias: "r",
      describe: "RPC URL",
      default: "http://127.0.0.1:8545",
    })
    .help()
    .parse();

  // Resolve config: ENV takes precedence, then flags
  const CONTRACT = process.env.CONTRACT || argv.contract;
  const PK = process.env.PK || argv.pk;
  const MNEMONIC = process.env.MNEMONIC || argv.mnemonic;
  const OPTION =
    process.env.OPTION !== undefined
      ? Number(process.env.OPTION)
      : argv.option !== undefined
      ? Number(argv.option)
      : undefined;
  const RPC = process.env.RPC || argv.rpc || "http://127.0.0.1:8545";

  // Validate inputs
  if (!CONTRACT)
    throw new Error("Missing contract address (CONTRACT env or --contract).");
  if (OPTION === undefined || Number.isNaN(OPTION))
    throw new Error("Missing/invalid OPTION (env or --option).");
  if (!PK && !MNEMONIC)
    throw new Error("Provide either PK env/--pk or MNEMONIC env/--mnemonic.");

  const provider = new ethers.JsonRpcProvider(RPC);

  // Build wallet
  let wallet;
  if (PK) {
    wallet = new ethers.Wallet(PK, provider);
  } else {
    wallet = ethers.Wallet.fromPhrase(MNEMONIC).connect(provider);
  }
  const addr = await wallet.getAddress();
  console.log("Using wallet address:", addr);

  // Attach contract with signer
  const voting = await ethers.getContractAt("Voting", CONTRACT, wallet);

  // Registration & double-vote checks
  const isRegistered = await voting.registered(addr);
  if (!isRegistered) {
    console.error(
      "Address is NOT registered. Ask admin to register this address first."
    );
    process.exit(1);
  }
  const already = await voting.hasVoted(addr);
  if (already) {
    console.error("This address has already voted.");
    process.exit(1);
  }

  // Build receipt = keccak256(address, optionIndex, nonce)
  const nonce = argv.nonce ?? "0x" + randomBytes(16).toString("hex");
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "bytes"],
    [addr, OPTION, nonce]
  );
  const receipt = ethers.keccak256(encoded);

  // Cast vote
  const tx = await voting.vote(OPTION, receipt);
  console.log("Sent tx:", tx.hash);
  await tx.wait();
  console.log("✅ Vote confirmed.");
  console.log("Nonce:", nonce);
  console.log("Receipt:", receipt);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
