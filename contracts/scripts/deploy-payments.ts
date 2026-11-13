import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";

// Deploys MerchantPayments. Fee is taken from the merchant's side of each payment.
//   PLATFORM_TREASURY_ADDRESS  wallet that receives fees (default: the deployer)
//   PLATFORM_FEE_BPS           basis points, 250 = 2.5% (default)
const { viem, networkName } = await network.create();
const [deployer] = await viem.getWalletClients();
const chainId = await (await viem.getPublicClient()).getChainId();
const treasury = (process.env.PLATFORM_TREASURY_ADDRESS || deployer.account.address) as `0x${string}`;
const feeBps = Number(process.env.PLATFORM_FEE_BPS || 250);

console.log(`Deploying MerchantPayments to ${networkName} (chainId ${chainId}), fee ${feeBps / 100}%, treasury ${treasury}`);
const payments = await viem.deployContract("MerchantPayments", [treasury, feeBps]);
console.log(`  MerchantPayments ${payments.address}`);

await mkdir("deployments", { recursive: true });
const file = `deployments/${networkName}-payments${networkName === "sepolia" ? "" : ".local"}.json`;
await writeFile(file, JSON.stringify({ network: networkName, chainId, merchantPayments: payments.address, treasury, feeBps, owner: deployer.account.address, deployedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`\nSaved ${file}\n\nAdd to backend/.env:\nPAYMENTS_CONTRACT_ADDRESS=${payments.address}\nPLATFORM_FEE_PERCENT=${feeBps / 100}`);
