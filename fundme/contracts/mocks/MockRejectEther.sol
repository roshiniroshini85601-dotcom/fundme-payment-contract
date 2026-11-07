// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFundMePlatform} from "../interfaces/IFundMePlatform.sol";

contract MockRejectEther {
    IFundMePlatform public platform;

    constructor(address _platform) {
        platform = IFundMePlatform(_platform);
    }

    function donate(uint256 campaignId) external payable {
        platform.contributeETH{value: msg.value}(campaignId);
    }

    // Revert on receiving ETH to simulate a DoS attack or incompatible contract
    receive() external payable {
        revert("I refuse ETH");
    }
}
