// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint256 public feeBps;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFee(uint256 _feeBps) external {
        feeBps = _feeBps;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (feeBps > 0) {
            uint256 fee = (amount * feeBps) / 10000;
            super.transfer(to, amount - fee);
            _burn(msg.sender, fee);
            return true;
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (feeBps > 0) {
            uint256 fee = (amount * feeBps) / 10000;
            super.transferFrom(from, to, amount - fee);
            _burn(from, fee);
            return true;
        }
        return super.transferFrom(from, to, amount);
    }
}
