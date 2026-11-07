import { network } from "hardhat";
import { parseEther } from "viem";

async function main() {
  const { viem } = await network.create();
  const [sender] = await viem.getWalletClients();
  const target = "0x23b0F134098ebe61d80932275C9603Bf0F0b15b0";
  console.log(`Sending 100 ETH from ${sender.account.address} to ${target}...`);
  const hash = await sender.sendTransaction({
    to: target,
    value: parseEther("100")
  });
  console.log("Tx hash:", hash);
  const pc = await viem.getPublicClient();
  const bal = await pc.getBalance({ address: target });
  console.log("New balance of user:", bal.toString());
}

main().catch(console.error);
