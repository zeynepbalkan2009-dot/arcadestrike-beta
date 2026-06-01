import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying with:', deployer.address);

  const ArcadeToken = await ethers.getContractFactory('ArcadeToken');
  const token = await ArcadeToken.deploy();
  await token.waitForDeployment();
  console.log('ArcadeToken deployed to:', await token.getAddress());
}

main().catch((err) => { console.error(err); process.exit(1); });
