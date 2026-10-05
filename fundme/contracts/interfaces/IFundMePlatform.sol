// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFundMePlatform
/// @notice Interface for the FundMePlatform smart contract
interface IFundMePlatform {
    struct Campaign {
        uint256 id;
        address payable creator;
        address tokenAddress; // address(0) for native token
        uint256 targetGoal;
        uint256 totalRaised;
        uint256 deadline;
        bool isCompleted;
        bool isFlexible; // true for flexible payout, false for All-or-Nothing
        bool exists;
    }

    /// @notice Emitted when a new campaign is created
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed creator,
        address indexed tokenAddress,
        uint256 targetGoal,
        uint256 deadline,
        bool isFlexible
    );

    /// @notice Emitted when a contribution is received
    event ContributionReceived(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount,
        address tokenAddress
    );

    /// @notice Emitted when creator withdraws raised funds
    event WithdrawalExecuted(
        uint256 indexed campaignId,
        address indexed creator,
        uint256 payoutAmount,
        uint256 feeAmount
    );

    /// @notice Emitted when donor claims a refund
    event RefundClaimed(
        uint256 indexed campaignId,
        address indexed donor,
        uint256 amount
    );

    /// @notice Emitted when KYC status is set for a creator
    event KycStatusUpdated(address indexed creator, bool status);

    /// @notice Emitted when token whitelist status is updated
    event TokenWhitelisted(address indexed token, bool status);

    /// @notice Emitted when fee recipient is updated
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    function createCampaign(
        address tokenAddress,
        uint256 targetGoal,
        uint256 durationInDays,
        bool isFlexible
    ) external returns (uint256);

    function createCampaign(
        address _beneficiary,
        uint256 _targetAmount,
        uint64 _deadline,
        address _paymentToken
    ) external returns (uint256);

    function contributeETH(uint256 campaignId) external payable;

    function donateNative(uint256 campaignId) external payable;

    function contributeToken(uint256 campaignId, uint256 amount) external;

    function donateToken(uint256 campaignId, uint256 amount) external;

    function withdrawFunds(uint256 campaignId) external;

    function executeWithdrawal(uint256 campaignId) external;

    function claimRefund(uint256 campaignId) external;

    function setWhitelistedToken(address token, bool status) external;

    function whitelistToken(address token) external;

    function setKycStatus(address creator, bool status) external;

    function setFeeRecipient(address newRecipient) external;

    function pause() external;

    function unpause() external;
}
