import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";

// Deploys KYCVerification. The deployer (PRIVATE_KEY) becomes the owner, so the backend
// must sign approvals with that same key (KYC_VERIFIER_PRIVATE_KEY in backend/.env).
const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
const chainId = await publicClient.getChainId();

console.log(`Deploying KYCVerification to ${networkName} (chainId ${chainId}) from ${deployer.account.address}`);
const kyc = await viem.deployContract("KYCVerification");
console.log(`  KYCVerification ${kyc.address}`);

await mkdir("deployments", { recursive: true });
const file = `deployments/${networkName}-kyc${networkName === "sepolia" ? "" : ".local"}.json`;
await writeFile(
  file,
  JSON.stringify({ network: networkName, chainId, owner: deployer.account.address, kycVerification: kyc.address, deployedAt: new Date().toISOString() }, null, 2) + "\n",
);
console.log(`\nSaved ${file}\n\nAdd to backend/.env:\nKYC_CONTRACT_ADDRESS=${kyc.address}`);
