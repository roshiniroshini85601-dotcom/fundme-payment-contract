import { network } from "hardhat";

async function main() {
    const { viem } = await network.create();

    const walletClients = await viem.getWalletClients();
    if (!walletClients || walletClients.length === 0) {
        console.error("\n[Error] No deployer account found!");
        console.error("Please add your MetaMask private key in fundme/.env:");
        console.error("SEPOLIA_PRIVATE_KEY=your_private_key_without_quotes\n");
        process.exit(1);
    }

    const deployer = walletClients[0];
    console.log("\n========================================");
    console.log("Deployer Address:", deployer.account.address);

    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    console.log("Connected Chain ID:", chainId);

    const balance = await publicClient.getBalance({ address: deployer.account.address });
    const balanceEth = Number(balance) / 1e18;
    console.log(`Account Balance: ${balanceEth} ETH`);

    if (balance === 0n) {
        console.error("\n[Error] Insufficient funds! Your deployer account has 0 Sepolia ETH.");
        console.error("Please request free Sepolia testnet ETH from faucets:");
        console.error("  1. https://cloud.google.com/application/web3/faucet/ethereum/sepolia");
        console.error("  2. https://sepoliafaucet.com");
        console.error(`Deployer Address to fund: ${deployer.account.address}\n`);
        process.exit(1);
    }

    console.log("\n1. Deploying FundMePlatform...");
    const platform = await viem.deployContract("FundMePlatform", [deployer.account.address, deployer.account.address]);
    console.log("-> FundMePlatform deployed to:", platform.address);

    // If on Sepolia testnet (chainId 11155111)
    if (chainId === 11155111) {
        const SEPOLIA_CHAINLINK_ETH_USD = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
        console.log("\n2. Linking Chainlink ETH/USD Sepolia Oracle:", SEPOLIA_CHAINLINK_ETH_USD);
        await platform.write.setPriceFeed([SEPOLIA_CHAINLINK_ETH_USD]);
        console.log("-> Real-time Sepolia oracle configured successfully!");
    } else {
        // Local testing: deploy MockERC20 and MockV3Aggregator
        console.log("\n2. Deploying MockERC20 for testing...");
        const mockToken = await viem.deployContract("MockERC20", ["Test USDC", "tUSDC"]);
        console.log("-> MockERC20 deployed to:", mockToken.address);

        await platform.write.whitelistToken([mockToken.address]);
        console.log("-> Whitelisted MockERC20 token");

        console.log("\n3. Deploying MockV3Aggregator ($2500 ETH/USD)...");
        const mockPriceFeed = await viem.deployContract("MockV3Aggregator", [8, 250000000000n]);
        console.log("-> MockV3Aggregator deployed to:", mockPriceFeed.address);

        await platform.write.setPriceFeed([mockPriceFeed.address]);
        console.log("-> Price feed set to MockV3Aggregator");
    }

    console.log("\n========================================");
    console.log("DEPLOYMENT SUCCESSFUL!");
    console.log("FundMePlatform Address:", platform.address);
    console.log("Copy this address into your frontend 'Contract' setting!");
    console.log("========================================\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
