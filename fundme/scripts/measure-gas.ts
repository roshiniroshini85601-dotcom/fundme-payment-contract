import { network } from "hardhat";
import { parseEther } from "viem";

async function main() {
    const { viem, networkHelpers } = await network.create();
    const [owner, kycAdmin, feeRecipient, creator, donor1] = await viem.getWalletClients();
    const pubClient = await viem.getPublicClient();

    console.log("--- Measuring Gas Baseline ---");

    // 1. Deployment
    const deployTx = await viem.deployContract("FundMePlatform", [
        owner.account.address,
        feeRecipient.account.address
    ]);
    const platform = deployTx;
    console.log("FundMePlatform deployed at:", platform.address);

    const mockToken = await viem.deployContract("MockERC20", ["Mock Token", "MTK"]);
    await platform.write.setWhitelistedToken([mockToken.address, true]);
    await platform.write.grantRole([await platform.read.KYC_ROLE(), kycAdmin.account.address]);

    // 2. createCampaign (ETH)
    let hash = await platform.write.createCampaign(
        ["0x0000000000000000000000000000000000000000", parseEther("5"), 30n, false],
        { account: creator.account }
    );
    let receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("createCampaign (ETH):", receipt.gasUsed.toString());

    // 3. createCampaign (ERC20)
    hash = await platform.write.createCampaign(
        [mockToken.address, parseEther("100"), 30n, true],
        { account: creator.account }
    );
    receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("createCampaign (ERC20):", receipt.gasUsed.toString());

    // 4. contributeETH (first contribution)
    hash = await platform.write.contributeETH([0n], {
        account: donor1.account,
        value: parseEther("2")
    });
    receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("contributeETH (first contribution):", receipt.gasUsed.toString());

    // 5. contributeETH (second contribution to existing donor)
    hash = await platform.write.contributeETH([0n], {
        account: donor1.account,
        value: parseEther("3")
    });
    receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("contributeETH (subsequent contribution):", receipt.gasUsed.toString());

    // 6. contributeToken
    await mockToken.write.mint([donor1.account.address, parseEther("100")]);
    await mockToken.write.approve([platform.address, parseEther("100")], { account: donor1.account });
    hash = await platform.write.contributeToken([1n, parseEther("100")], { account: donor1.account });
    receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("contributeToken:", receipt.gasUsed.toString());

    // 7. withdrawFunds (ETH, standard 5%)
    hash = await platform.write.withdrawFunds([0n], { account: creator.account });
    receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("withdrawFunds (ETH standard 5%):", receipt.gasUsed.toString());

    // 8. withdrawFunds (ERC20, KYC 1%)
    await platform.write.setKycStatus([creator.account.address, true], { account: kycAdmin.account });
    hash = await platform.write.withdrawFunds([1n], { account: creator.account });
    receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("withdrawFunds (ERC20 KYC 1%):", receipt.gasUsed.toString());

    // 9. claimRefund
    // Create campaign that fails
    hash = await platform.write.createCampaign(
        ["0x0000000000000000000000000000000000000000", parseEther("10"), 5n, false],
        { account: creator.account }
    );
    hash = await platform.write.contributeETH([2n], {
        account: donor1.account,
        value: parseEther("1")
    });
    const campaign2 = await platform.read.campaigns([2n]);
    // index 3 is deadline in packed struct
    const deadline = BigInt(campaign2[3]);
    await networkHelpers.time.increaseTo(deadline + 1n);

    hash = await platform.write.claimRefund([2n], { account: donor1.account });
    receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("claimRefund (ETH):", receipt.gasUsed.toString());

    // 10. batchWhitelistTokens
    const [mockToken2, mockToken3] = await Promise.all([
        viem.deployContract("MockERC20", ["Token 2", "TK2"]),
        viem.deployContract("MockERC20", ["Token 3", "TK3"])
    ]);
    hash = await platform.write.batchWhitelistTokens([[mockToken2.address, mockToken3.address], true]);
    receipt = await pubClient.getTransactionReceipt({ hash });
    console.log("batchWhitelistTokens (2 tokens):", receipt.gasUsed.toString());
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
