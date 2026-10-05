import { network } from "hardhat";
import { parseEther } from "viem";

async function main() {
    const { viem } = await network.create();

    const [deployer] = await viem.getWalletClients();
    console.log("Deploying contracts with the account:", deployer.account.address);

    const publicClient = await viem.getPublicClient();
    const balance = await publicClient.getBalance({address: deployer.account.address});
    console.log("Account balance:", balance.toString());

    // We will use the deployer as both the admin and the treasury for testnet deployment purposes.
    const platform = await viem.deployContract("FundMePlatform", [deployer.account.address, deployer.account.address]);

    console.log("FundMePlatform deployed to:", platform.address);

    // Optionally deploy a mock token for testing purposes on testnets
    const mockToken = await viem.deployContract("MockERC20", ["Test USDC", "tUSDC"]);
    console.log("MockERC20 deployed to:", mockToken.address);

    // Whitelist the mock token
    await platform.write.whitelistToken([mockToken.address]);
    console.log("Whitelisted MockERC20 token");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
