import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Token = await ethers.getContractFactory("ArcadeToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  console.log("ArcadeToken:", await token.getAddress());

  const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS!;
  const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS!;
  const BURN_ADDRESS = await token.getAddress();

  const Escrow = await ethers.getContractFactory("ArcadeStrikeEscrow");
  const escrow = await Escrow.deploy(ORACLE_ADDRESS, TREASURY_ADDRESS, BURN_ADDRESS);
  await escrow.waitForDeployment();
  console.log("Escrow:", await escrow.getAddress());

  console.log("\nSet these in your .env:");
  console.log("ESCROW_ADDRESS=" + await escrow.getAddress());
  console.log("TOKEN_ADDRESS=" + await token.getAddress());
}

main().catch(e => { console.error(e); process.exit(1); });
