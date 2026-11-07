import { network } from "hardhat";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";

describe("Gas Optimization & Storage Layout Benchmarks", function () {
    async function deployFixture() {
        const { viem, networkHelpers } = await network.create();
        const [owner, kycAdmin, reviewer, pauser, feeRecipient, creator, donor1, donor2, donor3] = await viem.getWalletClients();

        const platform = await viem.deployContract("FundMePlatform", [
            owner.account.address,
            feeRecipient.account.address
        ]);

        await platform.write.grantRole([await platform.read.KYC_ROLE(), kycAdmin.account.address]);
        await platform.write.grantRole([await platform.read.REVIEWER_ROLE(), reviewer.account.address]);
        await platform.write.grantRole([await platform.read.PAUSER_ROLE(), pauser.account.address]);

        const mockToken = await viem.deployContract("MockERC20", ["Mock Token", "MTK"]);
        await platform.write.setWhitelistedToken([mockToken.address, true]);

        const mockPriceFeed = await viem.deployContract("MockV3Aggregator", [8, 250000000000n]);
        await platform.write.setPriceFeed([mockPriceFeed.address]);

        const pubClient = await viem.getPublicClient();

        return {
            platform,
            mockToken,
            mockPriceFeed,
            viem,
            pubClient,
            networkHelpers,
            owner,
            kycAdmin,
            reviewer,
            pauser,
            feeRecipient,
            creator,
            donor1,
            donor2,
            donor3
        };
    }

    it("1. Storage Packing: createCampaign gas should be strictly optimized (< 125,000 gas)", async () => {
        const { networkHelpers } = await network.create();
        const { platform, creator, pubClient, mockToken } = await networkHelpers.loadFixture(deployFixture);

        // Native ETH campaign (previously ~147,250 gas)
        const hashETH = await platform.write.createCampaign(
            ["0x0000000000000000000000000000000000000000", parseEther("5"), 30n, false],
            { account: creator.account }
        );
        const receiptETH = await pubClient.getTransactionReceipt({ hash: hashETH });
        assert.ok(receiptETH.gasUsed < 125000n, `createCampaign ETH gas ${receiptETH.gasUsed} should be < 125000`);

        // ERC20 campaign (previously ~172,445 gas)
        const hashERC20 = await platform.write.createCampaign(
            [mockToken.address, parseEther("50"), 30n, true],
            { account: creator.account }
        );
        const receiptERC20 = await pubClient.getTransactionReceipt({ hash: hashERC20 });
        assert.ok(receiptERC20.gasUsed < 115000n, `createCampaign ERC20 gas ${receiptERC20.gasUsed} should be < 115000`);
    });

    it("2. Donation Flow Memory Caching: contributeETH & contributeToken gas benchmarks", async () => {
        const { networkHelpers } = await network.create();
        const { platform, creator, donor1, pubClient, mockToken } = await networkHelpers.loadFixture(deployFixture);

        await platform.write.createCampaign(
            ["0x0000000000000000000000000000000000000000", parseEther("10"), 10n, false],
            { account: creator.account }
        );

        // First contribution (cold write to contributions mapping, previously ~80,549 gas)
        const hash1 = await platform.write.contributeETH([0n], {
            account: donor1.account,
            value: parseEther("2")
        });
        const receipt1 = await pubClient.getTransactionReceipt({ hash: hash1 });
        assert.ok(receipt1.gasUsed < 65000n, `contributeETH cold gas ${receipt1.gasUsed} should be < 65000`);

        // Subsequent contribution (warm write to contributions mapping, previously ~46,349 gas)
        const hash2 = await platform.write.contributeETH([0n], {
            account: donor1.account,
            value: parseEther("1")
        });
        const receipt2 = await pubClient.getTransactionReceipt({ hash: hash2 });
        assert.ok(receipt2.gasUsed < 45000n, `contributeETH warm gas ${receipt2.gasUsed} should be < 45000`);

        // ERC20 contribution (previously ~118,828 gas)
        await platform.write.createCampaign(
            [mockToken.address, parseEther("100"), 10n, false],
            { account: creator.account }
        );
        await mockToken.write.mint([donor1.account.address, parseEther("50")]);
        await mockToken.write.approve([platform.address, parseEther("50")], { account: donor1.account });

        const hashToken = await platform.write.contributeToken([1n, parseEther("50")], { account: donor1.account });
        const receiptToken = await pubClient.getTransactionReceipt({ hash: hashToken });
        assert.ok(receiptToken.gasUsed < 100000n, `contributeToken gas ${receiptToken.gasUsed} should be < 100000`);
    });

    it("3. Withdrawal Flow Memory Caching: withdrawFunds benchmarks", async () => {
        const { networkHelpers } = await network.create();
        const { platform, creator, donor1, pubClient } = await networkHelpers.loadFixture(deployFixture);

        const target = parseEther("5");
        await platform.write.createCampaign(
            ["0x0000000000000000000000000000000000000000", target, 5n, false],
            { account: creator.account }
        );
        await platform.write.contributeETH([0n], { account: donor1.account, value: target });

        // Withdrawal with standard 5% fee (previously ~65,600 gas, with freeze check ~63,100 gas)
        const hashWithdraw = await platform.write.withdrawFunds([0n], { account: creator.account });
        const receiptWithdraw = await pubClient.getTransactionReceipt({ hash: hashWithdraw });
        assert.ok(receiptWithdraw.gasUsed < 65000n, `withdrawFunds gas ${receiptWithdraw.gasUsed} should be < 65000`);
    });

    it("4. Storage Clearance & Gas Refunds: claimRefund with delete keyword", async () => {
        const { networkHelpers } = await network.create();
        const { platform, creator, donor1, pubClient, networkHelpers: helpers } = await networkHelpers.loadFixture(deployFixture);

        await platform.write.createCampaign(
            ["0x0000000000000000000000000000000000000000", parseEther("10"), 5n, false],
            { account: creator.account }
        );
        await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("2") });

        const campaign = await platform.read.campaigns([0n]);
        const deadline = BigInt(campaign[3]);
        await helpers.time.increaseTo(deadline + 1n);

        // Refund with storage clearance (previously ~47,551 gas)
        const hashRefund = await platform.write.claimRefund([0n], { account: donor1.account });
        const receiptRefund = await pubClient.getTransactionReceipt({ hash: hashRefund });
        assert.ok(receiptRefund.gasUsed < 44000n, `claimRefund gas ${receiptRefund.gasUsed} should be < 44000`);
    });

    it("5. Batch Operations vs Sequential Execution: Gas comparison", async () => {
        const { networkHelpers } = await network.create();
        const { platform, creator, donor1, donor2, donor3, pubClient, networkHelpers: helpers } = await networkHelpers.loadFixture(deployFixture);

        await platform.write.createCampaign(
            ["0x0000000000000000000000000000000000000000", parseEther("100"), 5n, false],
            { account: creator.account }
        );

        await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") });
        await platform.write.contributeETH([0n], { account: donor2.account, value: parseEther("2") });
        await platform.write.contributeETH([0n], { account: donor3.account, value: parseEther("3") });

        const campaign = await platform.read.campaigns([0n]);
        const deadline = BigInt(campaign[3]);
        await helpers.time.increaseTo(deadline + 1n);

        // Execute batch refund for 3 donors in a single transaction
        const hashBatch = await platform.write.batchRefund([
            0n,
            [donor1.account.address, donor2.account.address, donor3.account.address]
        ]);
        const receiptBatch = await pubClient.getTransactionReceipt({ hash: hashBatch });

        // 3 individual claims would cost 3 * 41,758 = ~125,274 gas + base tx overhead (21,000 * 2 = 42,000 gas) = ~167,000 gas
        // Batch refund processes all 3 in a single transaction with loop optimizations & storage refunds
        assert.ok(receiptBatch.gasUsed < 100000n, `batchRefund for 3 donors ${receiptBatch.gasUsed} should be < 100,000 gas`);
    });
});
