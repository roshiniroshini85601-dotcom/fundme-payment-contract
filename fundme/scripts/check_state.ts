import { createPublicClient, http, formatEther } from "viem";
import { hardhat } from "viem/chains";

const ADDR = "0x610178da211fef7d417bc0e6fed39f05609ad788";

async function main() {
  const client = createPublicClient({ chain: hardhat, transport: http("http://127.0.0.1:8545") });
  const abi = [{ name: "campaigns", type: "function", inputs: [{ type: "uint256" }], outputs: 
  [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "bool" }, { type: "bool" }, { type: "bool" }, { type: "uint128" }, { type: "uint128" }], stateMutability: "view" }] as const;
  const nextId = await client.readContract({ address: ADDR, abi: [{ name: "nextCampaignId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const, functionName: "nextCampaignId" });
  console.log(`Total campaigns: ${nextId}`);
  for (let i = 0n; i < nextId; i++) {
    const res = await client.readContract({ address: ADDR, abi, functionName: "campaigns", args: [i] });
    console.log(`\nCampaign #${i} details:`);
    console.log("  Creator:", res[1]);
    console.log("  Token:", res[2]);
    console.log("  Deadline:", new Date(Number(res[3]) * 1000).toISOString());
    console.log("  Target Goal:", formatEther(res[7]), "ETH");
    console.log("  Total Raised:", formatEther(res[8]), "ETH");
  }
}
main().catch(console.error);
