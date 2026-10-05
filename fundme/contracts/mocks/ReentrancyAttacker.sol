// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFundMePlatform} from "../interfaces/IFundMePlatform.sol";

contract ReentrancyAttacker {
    IFundMePlatform public platform;
    uint256 public attackCampaignId;
    bool public isAttackingWithdrawal;
    bool public isAttackingRefund;

    constructor(address _platform) {
        platform = IFundMePlatform(_platform);
    }

    function attackWithdrawal(uint256 _campaignId) external {
        attackCampaignId = _campaignId;
        isAttackingWithdrawal = true;
        platform.executeWithdrawal(_campaignId);
    }

    function attackRefund(uint256 _campaignId) external {
        attackCampaignId = _campaignId;
        isAttackingRefund = true;
        platform.claimRefund(_campaignId);
    }

    receive() external payable {
        if (isAttackingWithdrawal) {
            isAttackingWithdrawal = false;
            platform.executeWithdrawal(attackCampaignId);
        } else if (isAttackingRefund) {
            isAttackingRefund = false;
            platform.claimRefund(attackCampaignId);
        }
    }
}
