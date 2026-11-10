import { network } from "hardhat";
import { parseEther, formatEther, keccak256, stringToBytes } from "viem";

// Active contract address:
const DEPLOYED_CONTRACT = "0x0165878a594ca255338adfa4d48449f69242eb8f" as `0x${string}`;

// Accounts to fund and grant admin/KYC privileges to (pass via CLI or add test addresses):
const ACCOUNTS_TO_SETUP: string[] = [
  // "0x..."
];

// Check if an address was passed via CLI: TARGET=0x...
if (process.env.TARGET && process.env.TARGET.startsWith("0x")) {
  ACCOUNTS_TO_SETUP.push(process.env.TARGET);
}

const AMOUNT_ETH = "10000";

async function main() {
  const { viem } = await network.create();
  const testClient = await viem.getTestClient();
  const publicClient = await viem.getPublicClient();
  const [adminClient] = await viem.getWalletClients();

  const kycRole = keccak256(stringToBytes("KYC_ROLE"));
  const reviewerRole = keccak256(stringToBytes("REVIEWER_ROLE"));

  console.log(`Setting up accounts (${AMOUNT_ETH} ETH + KYC/Reviewer Roles)...\n`);

  for (const addr of ACCOUNTS_TO_SETUP) {
    if (!addr.startsWith("0x") || addr.length !== 42) continue;
    const formattedAddr = addr as `0x${string}`;

    try {
      // 1. Set balance to 10,000 ETH
      await testClient.setBalance({
        address: formattedAddr,
        value: parseEther(AMOUNT_ETH)
      });
      const bal = await publicClient.getBalance({ address: formattedAddr });

      // 2. Grant KYC and REVIEWER roles
      const grantAbi = [
        {
          name: "grantRole",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "role", type: "bytes32" },
            { name: "account", type: "address" }
          ],
          outputs: []
        }
      ] as const;

      const tx1 = await adminClient.writeContract({
        address: DEPLOYED_CONTRACT,
        abi: grantAbi,
        functionName: "grantRole",
        args: [kycRole, formattedAddr]
      });
      await publicClient.waitForTransactionReceipt({ hash: tx1 });

      const tx2 = await adminClient.writeContract({
        address: DEPLOYED_CONTRACT,
        abi: grantAbi,
        functionName: "grantRole",
        args: [reviewerRole, formattedAddr]
      });
      await publicClient.waitForTransactionReceipt({ hash: tx2 });

      console.log(`✅ ${formattedAddr}: Funded ${formatEther(bal)} ETH | Granted KYC_ROLE + REVIEWER_ROLE`);
    } catch (err: any) {
      console.error(`❌ Failed for ${formattedAddr}:`, err.message || err);
    }
  }

  console.log("\nAll accounts are funded and ready!");
}

main().catch(console.error);
