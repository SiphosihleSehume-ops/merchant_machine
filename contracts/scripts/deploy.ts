import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";
import { ONE, TOKENS } from "./tokens.js";

const connection = await network.create();
const { viem, networkName } = connection;
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
const chainId = await publicClient.getChainId();

console.log(`Deploying to ${networkName} (chainId ${chainId}) from ${deployer.account.address}`);

const deployed: Record<string, unknown> = {};
for (const t of TOKENS) {
  const token = await viem.deployContract("TestStablecoin", [
    t.name,
    t.symbol,
    t.version,
    t.faucet * ONE,
    deployer.account.address,
  ]);
  deployed[t.key] = {
    address: token.address,
    name: t.name,
    symbol: t.symbol,
    version: t.version,
    decimals: 6,
  };
  console.log(`  ${t.symbol.padEnd(5)} ${token.address}`);
}

const out = {
  network: networkName,
  chainId,
  caip2: `eip155:${chainId}`,
  deployer: deployer.account.address,
  deployedAt: new Date().toISOString(),
  tokens: deployed,
};

await mkdir("deployments", { recursive: true });
const file = `deployments/${networkName}${networkName === "sepolia" ? "" : ".local"}.json`;
await writeFile(file, JSON.stringify(out, null, 2) + "\n");
console.log(`\nSaved ${file}`);
console.log("\nAdd to backend/.env and frontend .env.local:");
for (const [key, v] of Object.entries(deployed) as [string, { address: string }][]) {
  console.log(`TOKEN_${key}_ADDRESS=${v.address}`);
}
