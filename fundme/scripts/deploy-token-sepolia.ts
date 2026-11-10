import { network } from "hardhat";

const PLATFORM_ADDRESS = "0x2c32e5949a12f394261fa8568e0092dd8c468492" as `0x${string}`;

async function main() {
  const { viem } = await network.create();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const bal = await publicClient.getBalance({ address: deployer.account.address });
  console.log("Deployer:", deployer.account.address);
  console.log("Balance:", Number(bal) / 1e18, "ETH");

  console.log("\n1. Deploying MockERC20 (Test USD - tUSD) on Sepolia...");
  const token = await viem.deployContract("MockERC20", ["Test USD", "tUSD"]);
  console.log("-> Test Token deployed to:", token.address);

  console.log("\n2. Whitelisting Test Token on FundMePlatform...");
  const whitelistTx = await deployer.writeContract({
    address: PLATFORM_ADDRESS,
    abi: [
      {
        name: "whitelistToken",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "token", type: "address" }],
        outputs: []
      }
    ],
    functionName: "whitelistToken",
    args: [token.address]
  });
  await publicClient.waitForTransactionReceipt({ hash: whitelistTx });
  console.log("-> Whitelisted successfully!");

  console.log("\n3. Minting 1,000 tUSD to deployer Account 7...");
  const mintTx = await deployer.writeContract({
    address: token.address,
    abi: [
      {
        name: "mint",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: []
      }
    ],
    functionName: "mint",
    args: [deployer.account.address, 1000000000000000000000n]
  });
  await publicClient.waitForTransactionReceipt({ hash: mintTx });
  console.log("-> Minted 1,000 tUSD to Account 7!");

  console.log("\n========================================");
  console.log("TOKEN SETUP ON SEPOLIA COMPLETE!");
  console.log("Token Address:", token.address);
  console.log("========================================");
}

main().catch(console.error);

