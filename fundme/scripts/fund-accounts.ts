import { network } from "hardhat";
import { parseEther, formatEther } from "viem";

// Add any account address you want to fund with 10,000 ETH:
const ACCOUNTS_TO_FUND: string[] = [
  "0x23b0F134098ebe61d80932275C9603Bf0F0b15b0", // Account 7
  // Paste your Account 8 address below:
  // "0x...",
];

// Check if an address was passed via environment variable (TARGET=0x...)
if (process.env.TARGET && process.env.TARGET.startsWith("0x")) {
  ACCOUNTS_TO_FUND.push(process.env.TARGET);
}

const AMOUNT_ETH = "10000";

async function main() {
  const { viem } = await network.create();
  const testClient = await viem.getTestClient();
  const publicClient = await viem.getPublicClient();

  console.log(`Starting funding process (${AMOUNT_ETH} ETH each)...\n`);

  for (const addr of ACCOUNTS_TO_FUND) {
    if (!addr.startsWith("0x") || addr.length !== 42) {
      console.log(`⚠️ Skipping invalid address: "${addr}"`);
      continue;
    }

    try {
      await testClient.setBalance({
        address: addr as `0x${string}`,
        value: parseEther(AMOUNT_ETH)
      });

      const bal = await publicClient.getBalance({ address: addr as `0x${string}` });
      console.log(`✅ Funded ${addr}: ${formatEther(bal)} ETH`);
    } catch (err: any) {
      console.error(`❌ Failed to fund ${addr}:`, err.message || err);
    }
  }

  console.log("\nDone! Check your MetaMask balances.");
}

main().catch(console.error);

