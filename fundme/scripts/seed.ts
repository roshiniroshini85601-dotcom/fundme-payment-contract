import { network } from "hardhat";
import { parseEther, formatEther } from "viem";

const FUNDME_ADDRESS = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const ETH_ZERO = "0x0000000000000000000000000000000000000000";

const ACCOUNT_LABELS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
];

async function main() {
  const { viem } = await network.create();
  const [acc0, acc1, acc2, acc3, acc4] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const NEXT_ID_ABI = [{ name: "nextCampaignId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const;

  const platform = await viem.getContractAt("FundMePlatform", FUNDME_ADDRESS as `0x${string}`);

  const nextId = await publicClient.readContract({ address: FUNDME_ADDRESS as `0x${string}`, abi: NEXT_ID_ABI, functionName: "nextCampaignId" });
  console.log("Current nextCampaignId:", nextId.toString());

  if (Number(nextId) === 0) {
    await platform.write.createCampaign([ETH_ZERO as `0x${string}`, parseEther("5"), 30n, false], { account: acc0.account });
    console.log("Created Campaign #0: 5 ETH goal, All-or-Nothing, 30 days (acc0)");

    await platform.write.createCampaign([ETH_ZERO as `0x${string}`, parseEther("2"), 14n, true], { account: acc1.account });
    console.log("Created Campaign #1: 2 ETH goal, Flexible, 14 days (acc1)");

    await platform.write.createCampaign([ETH_ZERO as `0x${string}`, parseEther("1"), 7n, false], { account: acc2.account });
    console.log("Created Campaign #2: 1 ETH goal, All-or-Nothing, 7 days (acc2)");
  } else {
    console.log("Campaigns already exist, skipping creation.");
  }

  await platform.write.contributeETH([0n], { account: acc3.account, value: parseEther("0.5") });
  console.log("Account #3 donated 0.5 ETH to Campaign #0");

  await platform.write.contributeETH([1n], { account: acc4.account, value: parseEther("0.3") });
  console.log("Account #4 donated 0.3 ETH to Campaign #1");

  const finalId = await publicClient.readContract({ address: FUNDME_ADDRESS as `0x${string}`, abi: NEXT_ID_ABI, functionName: "nextCampaignId" });
  console.log("\nTotal campaigns now:", finalId.toString());

  for (let i = 0; i < ACCOUNT_LABELS.length; i++) {
    const bal = await publicClient.getBalance({ address: ACCOUNT_LABELS[i] as `0x${string}` });
    console.log(`  Hardhat Account #${i}: ${formatEther(bal)} ETH`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
