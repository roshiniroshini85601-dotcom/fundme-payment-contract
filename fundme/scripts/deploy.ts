import { network } from "hardhat";

async function main() {
    const { viem } = await network.create();

    const [deployer] = await viem.getWalletClients();
    console.log("Deploying contracts with the account:", deployer.account.address);

    const publicClient = await viem.getPublicClient();
    const balance = await publicClient.getBalance({address: deployer.account.address});
    console.log("Account balance:", balance.toString());

    // Deploy FundMePlatform (deployer = admin & treasury)
    const platform = await viem.deployContract("FundMePlatform", [deployer.account.address, deployer.account.address]);
    console.log("FundMePlatform deployed to:", platform.address);

    // Deploy MockERC20 for local testing
    const mockToken = await viem.deployContract("MockERC20", ["Test USDC", "tUSDC"]);
    console.log("MockERC20 deployed to:", mockToken.address);

    // Whitelist the mock token
    await platform.write.whitelistToken([mockToken.address]);
    console.log("Whitelisted MockERC20 token");

    // Deploy MockV3Aggregator: 8 decimals, ETH price = $2500 (250000000000 in 8 dec)
    const mockPriceFeed = await viem.deployContract("MockV3Aggregator", [8, 250000000000n]);
    console.log("MockV3Aggregator deployed to:", mockPriceFeed.address);

    // Set the price feed on the platform so getLatestETHPrice() works
    await platform.write.setPriceFeed([mockPriceFeed.address]);
    console.log("Price feed set to MockV3Aggregator ($2500 ETH/USD)");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
