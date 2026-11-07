import { network } from "hardhat";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";

describe("FundMePlatform Smart Contract & Security Suite", function () {
    async function deployFixture() {
        const { viem, networkHelpers } = await network.create();
        const [owner, kycAdmin, reviewer, pauser, feeRecipient, creator, donor1, donor2] = await viem.getWalletClients();
        
        const platform = await viem.deployContract("FundMePlatform", [
            owner.account.address,
            feeRecipient.account.address
        ]);
        
        // Grant roles
        await platform.write.grantRole([await platform.read.KYC_ROLE(), kycAdmin.account.address]);
        await platform.write.grantRole([await platform.read.REVIEWER_ROLE(), reviewer.account.address]);
        await platform.write.grantRole([await platform.read.PAUSER_ROLE(), pauser.account.address]);

        // Deploy and whitelist mock ERC20 token
        const mockToken = await viem.deployContract("MockERC20", ["Mock Token", "MTK"]);
        await platform.write.setWhitelistedToken([mockToken.address, true]);

        // Deploy Mock Chainlink Aggregator ($2500.00 with 8 decimals)
        const mockPriceFeed = await viem.deployContract("MockV3Aggregator", [8, 250000000000n]);
        await platform.write.setPriceFeed([mockPriceFeed.address]);
        
        return {
            platform,
            mockToken,
            mockPriceFeed,
            viem,
            networkHelpers,
            owner,
            kycAdmin,
            reviewer,
            pauser,
            feeRecipient,
            creator,
            donor1,
            donor2
        };
    }

    describe("1. Deployment & Role Setup", function () {
        it("should verify default roles, fee recipient, and whitelisted tokens", async () => {
            const { networkHelpers } = await network.create();
            const { platform, mockToken, owner, kycAdmin, pauser, feeRecipient } = await networkHelpers.loadFixture(deployFixture);

            // Check Fee Recipient
            const currentFeeRecipient = await platform.read.feeRecipient();
            assert.equal(currentFeeRecipient.toLowerCase(), feeRecipient.account.address.toLowerCase());

            // Check Roles
            const adminRole = await platform.read.DEFAULT_ADMIN_ROLE();
            const kycRole = await platform.read.KYC_ROLE();
            const pauserRole = await platform.read.PAUSER_ROLE();

            assert.equal(await platform.read.hasRole([adminRole, owner.account.address]), true);
            assert.equal(await platform.read.hasRole([kycRole, kycAdmin.account.address]), true);
            assert.equal(await platform.read.hasRole([pauserRole, pauser.account.address]), true);

            // Check Whitelisted Token
            assert.equal(await platform.read.whitelistedTokens([mockToken.address]), true);
        });

        it("should fetch real-time ETH price and convert USD to ETH via Chainlink Oracles", async () => {
            const { networkHelpers } = await network.create();
            const { platform, mockPriceFeed } = await networkHelpers.loadFixture(deployFixture);

            // $2,500.00 in 8 decimals = 250000000000
            const ethPrice = await platform.read.getLatestETHPrice();
            assert.equal(ethPrice, 250000000000n);

            // Target goal $5,000 USD (formatted with 18 decimals)
            const usdGoal = parseEther("5000"); // 5000 * 1e18
            const expectedETHWei = (usdGoal * 100000000n) / ethPrice; // (5000 * 1e18 * 1e8) / 2500e8 = 2 * 1e18 (2 ETH)

            const calculatedETHWei = await platform.read.getETHAmountFromUSD([usdGoal]);
            assert.equal(calculatedETHWei, expectedETHWei);
            assert.equal(calculatedETHWei, parseEther("2"));
        });
    });

    describe("2. Campaign Lifecycle & Multi-Token Funding", function () {
        it("should create native ETH and ERC20 campaigns correctly", async () => {
            const { networkHelpers } = await network.create();
            const { platform, mockToken, creator } = await networkHelpers.loadFixture(deployFixture);

            const targetGoal = parseEther("5");
            const durationInDays = 30n;

            // Create Native ETH campaign (isFlexible = false)
            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", targetGoal, durationInDays, false],
                { account: creator.account }
            );

            const ethCampaign = await platform.read.campaigns([0n]);
            assert.equal(ethCampaign[0], 0n); // id
            assert.equal(ethCampaign[1].toLowerCase(), creator.account.address.toLowerCase()); // creator
            assert.equal(ethCampaign[2], "0x0000000000000000000000000000000000000000"); // tokenAddress
            assert.equal(ethCampaign[4], false); // isCompleted
            assert.equal(ethCampaign[5], false); // isFlexible
            assert.equal(ethCampaign[6], true); // exists
            assert.equal(ethCampaign[7], targetGoal); // targetGoal
            assert.equal(ethCampaign[8], 0n); // totalRaised

            // Create ERC20 campaign (isFlexible = true)
            await platform.write.createCampaign(
                [mockToken.address, targetGoal, durationInDays, true],
                { account: creator.account }
            );

            const tokenCampaign = await platform.read.campaigns([1n]);
            assert.equal(tokenCampaign[0], 1n); // id
            assert.equal(tokenCampaign[2].toLowerCase(), mockToken.address.toLowerCase()); // tokenAddress
            assert.equal(tokenCampaign[5], true); // isFlexible
        });

        it("should process native ETH contributions via contributeETH", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, donor1 } = await networkHelpers.loadFixture(deployFixture);

            const targetGoal = parseEther("2");
            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", targetGoal, 7n, false],
                { account: creator.account }
            );

            const contributeAmount = parseEther("1");
            await platform.write.contributeETH([0n], { account: donor1.account, value: contributeAmount });

            const campaign = await platform.read.campaigns([0n]);
            assert.equal(campaign[8], contributeAmount); // totalRaised

            const donorContribution = await platform.read.contributions([0n, donor1.account.address]);
            assert.equal(donorContribution, contributeAmount);
        });

        it("should process ERC20 contributions via contributeToken with SafeERC20", async () => {
            const { networkHelpers } = await network.create();
            const { platform, mockToken, creator, donor1 } = await networkHelpers.loadFixture(deployFixture);

            const targetGoal = parseEther("100");
            await platform.write.createCampaign(
                [mockToken.address, targetGoal, 14n, false],
                { account: creator.account }
            );

            const mintAmount = parseEther("500");
            const contributeAmount = parseEther("100");

            // Mint tokens to donor1 and approve platform
            await mockToken.write.mint([donor1.account.address, mintAmount]);
            await mockToken.write.approve([platform.address, contributeAmount], { account: donor1.account });

            // Contribute ERC20 tokens
            await platform.write.contributeToken([0n, contributeAmount], { account: donor1.account });

            const campaign = await platform.read.campaigns([0n]);
            assert.equal(campaign[8], contributeAmount); // totalRaised

            const contractBalance = await mockToken.read.balanceOf([platform.address]);
            assert.equal(contractBalance, contributeAmount);
        });
    });

    describe("3. Tiered Fee Deduction Verification", function () {
        it("should deduct 5% standard fee for unverified creator upon withdrawal", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, donor1, feeRecipient, viem } = await networkHelpers.loadFixture(deployFixture);

            const targetGoal = parseEther("10");
            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", targetGoal, 10n, false],
                { account: creator.account }
            );

            await platform.write.contributeETH([0n], { account: donor1.account, value: targetGoal });

            const pubClient = await viem.getPublicClient();
            const feeBalBefore = await pubClient.getBalance({ address: feeRecipient.account.address });
            const creatorBalBefore = await pubClient.getBalance({ address: creator.account.address });

            // Creator withdraws funds
            const txHash = await platform.write.withdrawFunds([0n], { account: creator.account });
            const receipt = await pubClient.getTransactionReceipt({ hash: txHash });
            const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

            const feeBalAfter = await pubClient.getBalance({ address: feeRecipient.account.address });
            const creatorBalAfter = await pubClient.getBalance({ address: creator.account.address });

            // Standard fee = 5% (500 BPS)
            const expectedFee = (targetGoal * 500n) / 10000n; // 0.5 ETH
            const expectedPayout = targetGoal - expectedFee;  // 9.5 ETH

            assert.equal(feeBalAfter - feeBalBefore, expectedFee);
            assert.equal(creatorBalAfter - creatorBalBefore + gasUsed, expectedPayout);
        });

        it("should deduct 1% fee for KYC-verified creator upon withdrawal", async () => {
            const { networkHelpers } = await network.create();
            const { platform, kycAdmin, creator, donor1, feeRecipient, viem } = await networkHelpers.loadFixture(deployFixture);

            // Grant KYC verification status to creator
            await platform.write.setKycStatus([creator.account.address, true], { account: kycAdmin.account });
            assert.equal(await platform.read.isKycVerified([creator.account.address]), true);

            const targetGoal = parseEther("10");
            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", targetGoal, 10n, false],
                { account: creator.account }
            );

            await platform.write.contributeETH([0n], { account: donor1.account, value: targetGoal });

            const pubClient = await viem.getPublicClient();
            const feeBalBefore = await pubClient.getBalance({ address: feeRecipient.account.address });
            const creatorBalBefore = await pubClient.getBalance({ address: creator.account.address });

            // KYC Verified creator withdraws funds
            const txHash = await platform.write.withdrawFunds([0n], { account: creator.account });
            const receipt = await pubClient.getTransactionReceipt({ hash: txHash });
            const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

            const feeBalAfter = await pubClient.getBalance({ address: feeRecipient.account.address });
            const creatorBalAfter = await pubClient.getBalance({ address: creator.account.address });

            // KYC fee = 1% (100 BPS)
            const expectedFee = (targetGoal * 100n) / 10000n; // 0.1 ETH
            const expectedPayout = targetGoal - expectedFee;  // 9.9 ETH

            assert.equal(feeBalAfter - feeBalBefore, expectedFee);
            assert.equal(creatorBalAfter - creatorBalBefore + gasUsed, expectedPayout);
        });
    });

    describe("4. Donor Refund Edge Cases (Pull Payments)", function () {
        it("should allow donor to claim 100% refund when All-or-Nothing goal is unmet past deadline", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, donor1, viem, networkHelpers: helpers } = await networkHelpers.loadFixture(deployFixture);

            const targetGoal = parseEther("10");
            const durationInDays = 5n;
            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", targetGoal, durationInDays, false],
                { account: creator.account }
            );

            const donateAmount = parseEther("2");
            await platform.write.contributeETH([0n], { account: donor1.account, value: donateAmount });

            // Fast-forward time past campaign deadline
            const ethCampaign = await platform.read.campaigns([0n]);
            const deadline = BigInt(ethCampaign[3]); // deadline is at index 3 in packed struct
            await helpers.time.increaseTo(deadline + 1n);

            const pubClient = await viem.getPublicClient();
            const donorBalBefore = await pubClient.getBalance({ address: donor1.account.address });

            // Donor pulls refund
            const txHash = await platform.write.claimRefund([0n], { account: donor1.account });
            const receipt = await pubClient.getTransactionReceipt({ hash: txHash });
            const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

            const donorBalAfter = await pubClient.getBalance({ address: donor1.account.address });
            assert.equal(donorBalAfter - donorBalBefore + gasUsed, donateAmount);

            // Contribution should be zeroed out (CEI)
            const contributionAfter = await platform.read.contributions([0n, donor1.account.address]);
            assert.equal(contributionAfter, 0n);
        });

        it("should revert with ZeroContribution if non-donor or double-claimer attempts refund", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, donor1, donor2, viem, networkHelpers: helpers } = await networkHelpers.loadFixture(deployFixture);

            const targetGoal = parseEther("10");
            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", targetGoal, 5n, false],
                { account: creator.account }
            );

            await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") });

            const campaign = await platform.read.campaigns([0n]);
            const deadline = BigInt(campaign[3]); // deadline is at index 3 in packed struct
            await helpers.time.increaseTo(deadline + 1n);

            // Non-donor attempt -> revert ZeroContribution
            await viem.assertions.revertWithCustomError(
                platform.write.claimRefund([0n], { account: donor2.account }),
                platform,
                "ZeroContribution"
            );

            // First claim -> success
            await platform.write.claimRefund([0n], { account: donor1.account });

            // Second claim (double claimer) -> revert ZeroContribution
            await viem.assertions.revertWithCustomError(
                platform.write.claimRefund([0n], { account: donor1.account }),
                platform,
                "ZeroContribution"
            );
        });

        it("should revert with CampaignNotEnded if claimRefund is called before deadline", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, donor1, viem } = await networkHelpers.loadFixture(deployFixture);

            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", parseEther("10"), 5n, false],
                { account: creator.account }
            );

            await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") });

            await viem.assertions.revertWithCustomError(
                platform.write.claimRefund([0n], { account: donor1.account }),
                platform,
                "CampaignNotEnded"
            );
        });
    });

    describe("5. Security & Access Controls", function () {
        it("should prevent contributions when paused by PAUSER_ROLE", async () => {
            const { networkHelpers } = await network.create();
            const { platform, pauser, creator, donor1, viem } = await networkHelpers.loadFixture(deployFixture);

            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", parseEther("5"), 10n, false],
                { account: creator.account }
            );

            // Pauser triggers emergency pause
            await platform.write.pause({ account: pauser.account });

            // Contribution should fail while paused
            await assert.rejects(
                platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") })
            );

            // Unpause
            await platform.write.unpause({ account: pauser.account });

            // Contribution should succeed after unpausing
            await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") });
            assert.equal(await platform.read.contributions([0n, donor1.account.address]), parseEther("1"));
        });

        it("should revert unauthorized withdrawal attempts by non-creators", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, donor1, viem } = await networkHelpers.loadFixture(deployFixture);

            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", parseEther("1"), 10n, false],
                { account: creator.account }
            );

            await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") });

            // Donor trying to withdraw raised funds -> revert Unauthorized
            await viem.assertions.revertWithCustomError(
                platform.write.withdrawFunds([0n], { account: donor1.account }),
                platform,
                "Unauthorized"
            );
        });

        it("should revert campaign creation with unwhitelisted ERC20 tokens", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, viem } = await networkHelpers.loadFixture(deployFixture);

            const unwhitelistedToken = "0x1111111111111111111111111111111111111111";

            await viem.assertions.revertWithCustomError(
                platform.write.createCampaign(
                    [unwhitelistedToken, parseEther("10"), 10n, false],
                    { account: creator.account }
                ),
                platform,
                "TokenNotWhitelisted"
            );
        });

        it("should freeze campaign, blocking donations/withdrawals while allowing donor refunds", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, reviewer, donor1, viem } = await networkHelpers.loadFixture(deployFixture);

            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", parseEther("5"), 10n, false],
                { account: creator.account }
            );

            await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") });

            // Reviewer freezes the campaign
            await platform.write.setCampaignFrozen([0n, true], { account: reviewer.account });
            assert.equal(await platform.read.isCampaignFrozen([0n]), true);

            // Donations should revert
            await viem.assertions.revertWithCustomError(
                platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") }),
                platform,
                "CampaignFrozen"
            );

            // Withdrawal should revert
            await viem.assertions.revertWithCustomError(
                platform.write.withdrawFunds([0n], { account: creator.account }),
                platform,
                "CampaignFrozen"
            );

            // Donor CAN claim refund immediately when frozen
            const pubClient = await viem.getPublicClient();
            const balBefore = await pubClient.getBalance({ address: donor1.account.address });
            await platform.write.claimRefund([0n], { account: donor1.account });
            const balAfter = await pubClient.getBalance({ address: donor1.account.address });
            assert.ok(balAfter > balBefore);
        });
    });

    describe("6. Gas Optimization Features & Batch Operations", function () {
        it("should batch whitelist and de-whitelist tokens clearing storage", async () => {
            const { networkHelpers } = await network.create();
            const { platform, viem, owner } = await networkHelpers.loadFixture(deployFixture);

            const tokenA = await viem.deployContract("MockERC20", ["Token A", "TKA"]);
            const tokenB = await viem.deployContract("MockERC20", ["Token B", "TKB"]);

            // Batch whitelist
            await platform.write.batchWhitelistTokens([[tokenA.address, tokenB.address], true], { account: owner.account });
            assert.equal(await platform.read.whitelistedTokens([tokenA.address]), true);
            assert.equal(await platform.read.whitelistedTokens([tokenB.address]), true);

            // Batch de-whitelist (clears storage)
            await platform.write.batchWhitelistTokens([[tokenA.address, tokenB.address], false], { account: owner.account });
            assert.equal(await platform.read.whitelistedTokens([tokenA.address]), false);
            assert.equal(await platform.read.whitelistedTokens([tokenB.address]), false);
        });

        it("should batch refund multiple donors past deadline and clear storage", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator, donor1, donor2, viem, networkHelpers: helpers } = await networkHelpers.loadFixture(deployFixture);

            const targetGoal = parseEther("10");
            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", targetGoal, 5n, false],
                { account: creator.account }
            );

            // Two donors contribute
            await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("2") });
            await platform.write.contributeETH([0n], { account: donor2.account, value: parseEther("3") });

            // Fast forward past deadline
            const ethCampaign = await platform.read.campaigns([0n]);
            const deadline = BigInt(ethCampaign[3]);
            await helpers.time.increaseTo(deadline + 1n);

            const pubClient = await viem.getPublicClient();
            const donor1BalBefore = await pubClient.getBalance({ address: donor1.account.address });
            const donor2BalBefore = await pubClient.getBalance({ address: donor2.account.address });

            // Batch refund
            await platform.write.batchRefund([0n, [donor1.account.address, donor2.account.address]]);

            const donor1BalAfter = await pubClient.getBalance({ address: donor1.account.address });
            const donor2BalAfter = await pubClient.getBalance({ address: donor2.account.address });

            assert.equal(donor1BalAfter - donor1BalBefore, parseEther("2"));
            assert.equal(donor2BalAfter - donor2BalBefore, parseEther("3"));

            // Verify storage cleared
            assert.equal(await platform.read.contributions([0n, donor1.account.address]), 0n);
            assert.equal(await platform.read.contributions([0n, donor2.account.address]), 0n);
        });

        it("should successfully batch refund valid donors even if one malicious donor reverts (DoS protection)", async () => {
            const { networkHelpers } = await network.create();
            const { platform, viem, creator, donor1, donor2, networkHelpers: helpers } = await networkHelpers.loadFixture(deployFixture);

            // Deploy MockRejectEther
            const rejectEther = await viem.deployContract("MockRejectEther", [platform.address]);

            // Create campaign
            await platform.write.createCampaign(["0x0000000000000000000000000000000000000000", parseEther("10"), 7n, false], { account: creator.account });

            // Donor 1 (valid), RejectEther contract (malicious/reverting), Donor 2 (valid) donate
            await platform.write.contributeETH([0n], { account: donor1.account, value: parseEther("1") });
            await rejectEther.write.donate([0n], { value: parseEther("2") });
            await platform.write.contributeETH([0n], { account: donor2.account, value: parseEther("3") });

            // Fast forward past deadline using the fixture's helpers
            const ethCampaign = await platform.read.campaigns([0n]);
            await helpers.time.increaseTo(BigInt(ethCampaign[3]) + 1n);

            const pubClient = await viem.getPublicClient();
            const donor1BalBefore = await pubClient.getBalance({ address: donor1.account.address });
            const donor2BalBefore = await pubClient.getBalance({ address: donor2.account.address });

            // Batch refund including the reverting contract: donor1, rejectEther, donor2
            await platform.write.batchRefund([0n, [donor1.account.address, rejectEther.address, donor2.account.address]]);

            const donor1BalAfter = await pubClient.getBalance({ address: donor1.account.address });
            const donor2BalAfter = await pubClient.getBalance({ address: donor2.account.address });

            // Valid donors received their refunds!
            assert.equal(donor1BalAfter - donor1BalBefore, parseEther("1"));
            assert.equal(donor2BalAfter - donor2BalBefore, parseEther("3"));

            // Valid donors' contribution storage is cleared
            assert.equal(await platform.read.contributions([0n, donor1.account.address]), 0n);
            assert.equal(await platform.read.contributions([0n, donor2.account.address]), 0n);

            // The failing donor's contribution is safely preserved so funds are not lost
            assert.equal(await platform.read.contributions([0n, rejectEther.address]), parseEther("2"));
        });

        it("should retrieve campaign via getCampaign view helper", async () => {
            const { networkHelpers } = await network.create();
            const { platform, creator } = await networkHelpers.loadFixture(deployFixture);

            const targetGoal = parseEther("5");
            await platform.write.createCampaign(
                ["0x0000000000000000000000000000000000000000", targetGoal, 10n, true],
                { account: creator.account }
            );

            const c = await platform.read.getCampaign([0n]);
            assert.equal(c.id, 0n);
            assert.equal(c.creator.toLowerCase(), creator.account.address.toLowerCase());
            assert.equal(c.targetGoal, targetGoal);
            assert.equal(c.isFlexible, true);
            assert.equal(c.exists, true);
        });

        it("should clear KYC and whitelisted tokens storage when disabled", async () => {
            const { networkHelpers } = await network.create();
            const { platform, kycAdmin, creator, mockToken, owner } = await networkHelpers.loadFixture(deployFixture);

            // Grant KYC
            await platform.write.setKycStatus([creator.account.address, true], { account: kycAdmin.account });
            assert.equal(await platform.read.isKycVerified([creator.account.address]), true);

            // Revoke KYC (deletes storage slot)
            await platform.write.setKycStatus([creator.account.address, false], { account: kycAdmin.account });
            assert.equal(await platform.read.isKycVerified([creator.account.address]), false);

            // Remove whitelisted token (deletes storage slot)
            await platform.write.removeWhitelistedToken([mockToken.address], { account: owner.account });
            assert.equal(await platform.read.whitelistedTokens([mockToken.address]), false);
        });
    });
});

