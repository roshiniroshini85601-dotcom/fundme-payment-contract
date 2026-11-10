import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import * as dotenv from "dotenv";
dotenv.config();

const rawPrivateKey = process.env.SEPOLIA_PRIVATE_KEY?.trim().replace(/^0x/, "");
const isHexKey = typeof rawPrivateKey === "string" && /^[0-9a-fA-F]{64}$/.test(rawPrivateKey);
const sepoliaAccounts = isHexKey ? [`0x${rawPrivateKey}`] : [];

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.34",
      },
      production: {
        version: "0.8.34",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
      // Suppress MetaMask token-detection probe noise
      loggingEnabled: false,
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
      loggingEnabled: false,
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: sepoliaAccounts,
    },
  },
});
