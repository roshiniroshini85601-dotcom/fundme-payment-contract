// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FundMe Errors
/// @notice Centralized library for all custom errors used in the FundMePlatform
library FundMeErrors {
    error InvalidGoal();
    error CampaignExpired();
    error CampaignNotEnded();
    error GoalNotReached();
    error GoalAlreadyReached();
    error ZeroContribution();
    error TokenNotWhitelisted();
    error TransferFailed();
    error Unauthorized();
    error CampaignDoesNotExist();
    error InvalidDeadline();
    error InvalidRecipient();
    error InvalidPaymentToken();
    error AlreadyWithdrawn();
    error TreasuryTransferFailed();
    error BeneficiaryTransferFailed();
    error RefundTransferFailed();
    error InvalidPrice();
}
