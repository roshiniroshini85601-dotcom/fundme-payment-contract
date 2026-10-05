// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFundMePlatform} from "./interfaces/IFundMePlatform.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {FundMeErrors} from "./libraries/FundMeErrors.sol";

/// @title FundMePlatform
/// @notice Central platform contract for managing crowdfunding campaigns, donations, and withdrawals
contract FundMePlatform is IFundMePlatform, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant KYC_ROLE = keccak256("KYC_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant STANDARD_FEE_BPS = 500; // 5%
    uint16 public constant KYC_FEE_BPS = 100;      // 1%
    uint16 public constant VERIFIED_CHARITY_FEE_BPS = 100; // 1%

    uint256 public nextCampaignId;
    address public feeRecipient;
    address public priceFeedAddress;

    mapping(uint256 => Campaign) public campaigns;
    // campaignId => (donor => amount)
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(address => bool) public whitelistedTokens;
    mapping(address => bool) public isKycVerified;

    constructor(address _initialAdmin, address _feeRecipient) {
        if (_feeRecipient == address(0)) revert FundMeErrors.InvalidRecipient();
        if (_initialAdmin == address(0)) revert FundMeErrors.Unauthorized();
        
        feeRecipient = _feeRecipient;

        _grantRole(DEFAULT_ADMIN_ROLE, _initialAdmin);
        _grantRole(KYC_ROLE, _initialAdmin);
        _grantRole(REVIEWER_ROLE, _initialAdmin);
        _grantRole(PAUSER_ROLE, _initialAdmin);
    }

    /// @notice Treasury getter for backwards compatibility
    function treasury() external view returns (address) {
        return feeRecipient;
    }

    /// @notice Set Chainlink Price Feed contract address
    /// @param _priceFeed The Chainlink ETH/USD Aggregator address
    function setPriceFeed(address _priceFeed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceFeedAddress = _priceFeed;
    }

    /// @notice Get latest ETH price in USD from Chainlink (with 8 decimals accuracy)
    function getLatestETHPrice() public view returns (uint256) {
        if (priceFeedAddress == address(0)) revert FundMeErrors.InvalidPrice();
        (, int256 price, , uint256 updatedAt, ) = AggregatorV3Interface(priceFeedAddress).latestRoundData();
        if (price <= 0 || updatedAt == 0) revert FundMeErrors.InvalidPrice();
        return uint256(price);
    }

    /// @notice Convert target goal in USD (with 18 decimals) into equivalent ETH wei
    /// @param usdAmount Amount in USD (formatted with 18 decimals)
    /// @return ethWei Amount of ETH in wei
    function getETHAmountFromUSD(uint256 usdAmount) public view returns (uint256 ethWei) {
        uint256 ethPriceInUSD = getLatestETHPrice(); // 8 decimals e.g., 2500_00000000
        ethWei = (usdAmount * 1e8) / ethPriceInUSD;
    }

    /// @notice Update the fee recipient address
    /// @param _newRecipient The new fee recipient address
    function setFeeRecipient(address _newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newRecipient == address(0)) revert FundMeErrors.InvalidRecipient();
        address oldRecipient = feeRecipient;
        feeRecipient = _newRecipient;
        emit FeeRecipientUpdated(oldRecipient, _newRecipient);
    }

    /// @notice Set treasury address (alias for setFeeRecipient)
    function setTreasury(address _newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newTreasury == address(0)) revert FundMeErrors.InvalidRecipient();
        address oldRecipient = feeRecipient;
        feeRecipient = _newTreasury;
        emit FeeRecipientUpdated(oldRecipient, _newTreasury);
    }

    /// @notice Whitelist or update an ERC20 token for donations
    /// @param _token The token address
    /// @param _status Whitelist status
    function setWhitelistedToken(address _token, bool _status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedTokens[_token] = _status;
        emit TokenWhitelisted(_token, _status);
    }

    /// @notice Whitelist an ERC20 token for donations (alias)
    function whitelistToken(address _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedTokens[_token] = true;
        emit TokenWhitelisted(_token, true);
    }

    /// @notice Remove an ERC20 token from the whitelist (alias)
    function removeWhitelistedToken(address _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedTokens[_token] = false;
        emit TokenWhitelisted(_token, false);
    }

    /// @notice Set KYC status for a creator address
    /// @param _creator Creator address
    /// @param _status KYC verification status
    function setKycStatus(address _creator, bool _status) external onlyRole(KYC_ROLE) {
        isKycVerified[_creator] = _status;
        emit KycStatusUpdated(_creator, _status);
    }

    /// @notice Set charity verification status for a campaign (alias for setKycStatus)
    function setCharityStatus(uint256 _campaignId, bool _status) external onlyRole(KYC_ROLE) {
        if (!campaigns[_campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
        address creator = campaigns[_campaignId].creator;
        isKycVerified[creator] = _status;
        emit KycStatusUpdated(creator, _status);
    }

    /// @notice Pause contract operations
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpause contract operations
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Create a new campaign with duration in days
    function createCampaign(
        address tokenAddress,
        uint256 targetGoal,
        uint256 durationInDays,
        bool isFlexible
    ) external whenNotPaused returns (uint256 campaignId) {
        if (targetGoal == 0) revert FundMeErrors.InvalidGoal();
        if (durationInDays == 0) revert FundMeErrors.InvalidDeadline();
        if (tokenAddress != address(0) && !whitelistedTokens[tokenAddress]) {
            revert FundMeErrors.TokenNotWhitelisted();
        }

        campaignId = nextCampaignId++;
        uint256 deadline = block.timestamp + (durationInDays * 1 days);

        campaigns[campaignId] = Campaign({
            id: campaignId,
            creator: payable(msg.sender),
            tokenAddress: tokenAddress,
            targetGoal: targetGoal,
            totalRaised: 0,
            deadline: deadline,
            isCompleted: false,
            isFlexible: isFlexible,
            exists: true
        });

        emit CampaignCreated(
            campaignId,
            msg.sender,
            tokenAddress,
            targetGoal,
            deadline,
            isFlexible
        );
    }

    /// @notice Create campaign with explicit beneficiary and deadline timestamp
    function createCampaign(
        address _beneficiary,
        uint256 _targetAmount,
        uint64 _deadline,
        address _paymentToken
    ) external whenNotPaused returns (uint256 campaignId) {
        if (_targetAmount == 0) revert FundMeErrors.InvalidGoal();
        if (_deadline <= block.timestamp) revert FundMeErrors.InvalidDeadline();
        if (_beneficiary == address(0)) revert FundMeErrors.InvalidRecipient();
        if (_paymentToken != address(0) && !whitelistedTokens[_paymentToken]) {
            revert FundMeErrors.TokenNotWhitelisted();
        }

        campaignId = nextCampaignId++;

        campaigns[campaignId] = Campaign({
            id: campaignId,
            creator: payable(_beneficiary),
            tokenAddress: _paymentToken,
            targetGoal: _targetAmount,
            totalRaised: 0,
            deadline: uint256(_deadline),
            isCompleted: false,
            isFlexible: false,
            exists: true
        });

        emit CampaignCreated(
            campaignId,
            _beneficiary,
            _paymentToken,
            _targetAmount,
            uint256(_deadline),
            false
        );
    }

    /// @notice Contribute Native ETH to a campaign
    function contributeETH(uint256 campaignId) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert FundMeErrors.ZeroContribution();

        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (campaign.tokenAddress != address(0)) revert FundMeErrors.InvalidPaymentToken();
        if (block.timestamp >= campaign.deadline) revert FundMeErrors.CampaignExpired();
        if (campaign.isCompleted) revert FundMeErrors.CampaignExpired();

        uint256 amount = msg.value;
        campaign.totalRaised += amount;
        contributions[campaignId][msg.sender] += amount;

        emit ContributionReceived(campaignId, msg.sender, amount, address(0));
    }

    /// @notice Alias for contributeETH
    function donateNative(uint256 campaignId) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert FundMeErrors.ZeroContribution();

        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (campaign.tokenAddress != address(0)) revert FundMeErrors.InvalidPaymentToken();
        if (block.timestamp >= campaign.deadline) revert FundMeErrors.CampaignExpired();
        if (campaign.isCompleted) revert FundMeErrors.CampaignExpired();

        uint256 amount = msg.value;
        campaign.totalRaised += amount;
        contributions[campaignId][msg.sender] += amount;

        emit ContributionReceived(campaignId, msg.sender, amount, address(0));
    }

    /// @notice Contribute whitelisted ERC20 tokens to a campaign
    function contributeToken(uint256 campaignId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert FundMeErrors.ZeroContribution();

        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (campaign.tokenAddress == address(0)) revert FundMeErrors.InvalidPaymentToken();
        if (!whitelistedTokens[campaign.tokenAddress]) revert FundMeErrors.TokenNotWhitelisted();
        if (block.timestamp >= campaign.deadline) revert FundMeErrors.CampaignExpired();
        if (campaign.isCompleted) revert FundMeErrors.CampaignExpired();

        IERC20 token = IERC20(campaign.tokenAddress);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualAmount = token.balanceOf(address(this)) - balanceBefore;

        campaign.totalRaised += actualAmount;
        contributions[campaignId][msg.sender] += actualAmount;

        emit ContributionReceived(campaignId, msg.sender, actualAmount, campaign.tokenAddress);
    }

    /// @notice Alias for contributeToken
    function donateToken(uint256 campaignId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert FundMeErrors.ZeroContribution();

        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (campaign.tokenAddress == address(0)) revert FundMeErrors.InvalidPaymentToken();
        if (!whitelistedTokens[campaign.tokenAddress]) revert FundMeErrors.TokenNotWhitelisted();
        if (block.timestamp >= campaign.deadline) revert FundMeErrors.CampaignExpired();
        if (campaign.isCompleted) revert FundMeErrors.CampaignExpired();

        IERC20 token = IERC20(campaign.tokenAddress);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualAmount = token.balanceOf(address(this)) - balanceBefore;

        campaign.totalRaised += actualAmount;
        contributions[campaignId][msg.sender] += actualAmount;

        emit ContributionReceived(campaignId, msg.sender, actualAmount, campaign.tokenAddress);
    }

    /// @notice Request withdrawal (for approval workflow backwards compatibility)
    function requestWithdrawal(uint256 campaignId) external whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (msg.sender != campaign.creator) revert FundMeErrors.Unauthorized();
    }

    /// @notice Approve withdrawal
    function approveWithdrawal(uint256 campaignId) external onlyRole(REVIEWER_ROLE) whenNotPaused {
        if (!campaigns[campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
    }

    /// @notice Reject withdrawal
    function rejectWithdrawal(uint256 campaignId) external onlyRole(REVIEWER_ROLE) whenNotPaused {
        if (!campaigns[campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
    }

    /// @notice Withdraw funds for creator (pull payment pattern with CEI)
    function withdrawFunds(uint256 campaignId) public nonReentrant whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (msg.sender != campaign.creator) revert FundMeErrors.Unauthorized();
        if (campaign.isCompleted) revert FundMeErrors.AlreadyWithdrawn();

        if (!campaign.isFlexible) {
            if (campaign.totalRaised < campaign.targetGoal) revert FundMeErrors.GoalNotReached();
        } else {
            if (campaign.totalRaised == 0) revert FundMeErrors.ZeroContribution();
        }

        // Checks-Effects-Interactions (CEI Pattern)
        campaign.isCompleted = true;

        uint256 raised = campaign.totalRaised;
        uint256 feeBps = isKycVerified[campaign.creator] ? KYC_FEE_BPS : STANDARD_FEE_BPS;
        uint256 feeAmount = (raised * feeBps) / BPS_DENOMINATOR;
        uint256 payoutAmount = raised - feeAmount;

        address token = campaign.tokenAddress;
        if (token == address(0)) {
            (bool feeSuccess, ) = feeRecipient.call{value: feeAmount}("");
            if (!feeSuccess) revert FundMeErrors.TreasuryTransferFailed();

            (bool creatorSuccess, ) = campaign.creator.call{value: payoutAmount}("");
            if (!creatorSuccess) revert FundMeErrors.BeneficiaryTransferFailed();
        } else {
            IERC20(token).safeTransfer(feeRecipient, feeAmount);
            IERC20(token).safeTransfer(campaign.creator, payoutAmount);
        }

        emit WithdrawalExecuted(campaignId, campaign.creator, payoutAmount, feeAmount);
    }

    /// @notice Alias for withdrawFunds
    function executeWithdrawal(uint256 campaignId) external nonReentrant whenNotPaused {
        withdrawFunds(campaignId);
    }

    /// @notice Claim refund for failed All-or-Nothing campaigns (pull payment pattern with CEI)
    function claimRefund(uint256 campaignId) external nonReentrant whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (campaign.isCompleted) revert FundMeErrors.GoalAlreadyReached();
        if (campaign.isFlexible) revert FundMeErrors.GoalAlreadyReached();
        if (block.timestamp < campaign.deadline) revert FundMeErrors.CampaignNotEnded();
        if (campaign.totalRaised >= campaign.targetGoal) revert FundMeErrors.GoalAlreadyReached();

        uint256 refundAmount = contributions[campaignId][msg.sender];
        if (refundAmount == 0) revert FundMeErrors.ZeroContribution();

        // Checks-Effects-Interactions (CEI Pattern)
        contributions[campaignId][msg.sender] = 0;

        address token = campaign.tokenAddress;
        if (token == address(0)) {
            (bool success, ) = msg.sender.call{value: refundAmount}("");
            if (!success) revert FundMeErrors.RefundTransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, refundAmount);
        }

        emit RefundClaimed(campaignId, msg.sender, refundAmount);
    }
}
