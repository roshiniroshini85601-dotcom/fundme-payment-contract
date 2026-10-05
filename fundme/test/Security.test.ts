import { network } from "hardhat";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";

describe("Security Tests", function () {
    async function deployFixture() {
        const { viem, networkHelpers } = await network.create();
        const [owner, reviewer, treasury, beneficiary, attackerAccount, dummyDonor] = await viem.getWalletClients();
        
        const platform = await viem.deployContract("FundMePlatform", [owner.account.address, treasury.account.address]);
        await platform.write.grantRole([await platform.read.REVIEWER_ROLE(), reviewer.account.address]);

        const attacker = await viem.deployContract("ReentrancyAttacker", [platform.address]);
        
        return { platform, attacker, viem, networkHelpers, owner, reviewer, treasury, beneficiary, attackerAccount, dummyDonor };
    }

    it("should prevent reentrancy during withdrawal", async () => {
        const { networkHelpers } = await network.create();
        const { platform, attacker, dummyDonor, viem, networkHelpers: helpers } = await networkHelpers.loadFixture(deployFixture);

        const targetAmount = parseEther("1");
        const deadline = BigInt(await helpers.time.latest()) + 3600n;
        
        // Beneficiary is the attacker contract for this campaign
        await platform.write.createCampaign([
            attacker.address,
            targetAmount,
            deadline,
            "0x0000000000000000000000000000000000000000"
        ]);

        await platform.write.contributeETH([0n], { account: dummyDonor.account, value: targetAmount });

        // Impersonate attacker account to execute withdrawal attack
        await helpers.impersonateAccount(attacker.address);
        await helpers.setBalance(attacker.address, parseEther("1"));
        
        const attackerClient = await viem.getWalletClient(attacker.address);

        // Initiate reentrancy attack - blocked by OpenZeppelin ReentrancyGuard
        await viem.assertions.revertWithCustomError(
            attacker.write.attackWithdrawal([0n], { account: attackerClient.account }),
            platform,
            "ReentrancyGuardReentrantCall"
        );
    });

    it("should prevent reentrancy during refunds", async () => {
        const { networkHelpers } = await network.create();
        const { platform, attacker, beneficiary, viem, networkHelpers: helpers } = await networkHelpers.loadFixture(deployFixture);

        const targetAmount = parseEther("10");
        const deadline = BigInt(await helpers.time.latest()) + 3600n;
        
        await platform.write.createCampaign([
            beneficiary.account.address,
            targetAmount,
            deadline,
            "0x0000000000000000000000000000000000000000"
        ]);

        // Impersonate attacker to donate
        await helpers.impersonateAccount(attacker.address);
        await helpers.setBalance(attacker.address, parseEther("2"));
        const attackerClient = await viem.getWalletClient(attacker.address);
        await platform.write.contributeETH([0n], { account: attackerClient.account, value: parseEther("1") });

        // Fast forward to deadline expired without reaching target
        await helpers.time.increaseTo(deadline + 1n);

        // Initiate reentrancy attack - blocked by ReentrancyGuard & CEI
        await viem.assertions.revertWithCustomError(
            attacker.write.attackRefund([0n], { account: attackerClient.account }),
            platform,
            "RefundTransferFailed"
        );
    });
});
