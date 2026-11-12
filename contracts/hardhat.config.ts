import { config as loadEnv } from "dotenv";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// contracts/.env takes precedence; falls back to the repo-root .env
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: "../.env", quiet: true });

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: "0.8.28" },
      production: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
  verify: {
    etherscan: { apiKey: configVariable("ETHERSCAN_API_KEY") },
  },
});
