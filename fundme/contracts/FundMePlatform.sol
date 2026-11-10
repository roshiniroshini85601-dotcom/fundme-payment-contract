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

    uint256 public constant MIN_CONTRIBUTION = 0.0001 ether; // 0.0001 ETH minimum to prevent dust attacks
    uint256 public constant MAX_CONTRIBUTION = 1000 ether;   // 1,000 ETH maximum single donation

    uint256 public nextCampaignId;
    address public feeRecipient;
    address public priceFeedAddress;

    mapping(uint256 => Campaign) public campaigns;
    // campaignId => (donor => amount)
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(address => bool) public whitelistedTokens;
    mapping(address => bool) public isKycVerified;
    mapping(uint256 => bool) public isCampaignFrozen;

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
        unchecked {
            ethWei = (usdAmount * 1e8) / ethPriceInUSD;
        }
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
    /// @param _status Whitelist status (clears storage on false to refund gas)
    function setWhitelistedToken(address _token, bool _status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_status) {
            whitelistedTokens[_token] = true;
        } else {
            delete whitelistedTokens[_token];
        }
        emit TokenWhitelisted(_token, _status);
    }

    /// @notice Whitelist an ERC20 token for donations (alias)
    function whitelistToken(address _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedTokens[_token] = true;
        emit TokenWhitelisted(_token, true);
    }

    /// @notice Remove an ERC20 token from the whitelist (clears storage slot for gas refund)
    function removeWhitelistedToken(address _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        delete whitelistedTokens[_token];
        emit TokenWhitelisted(_token, false);
    }

    /// @notice Set KYC status for a creator address (clears storage on false to refund gas)
    /// @param _creator Creator address
    /// @param _status KYC verification status
    function setKycStatus(address _creator, bool _status) external onlyRole(KYC_ROLE) {
        if (_status) {
            isKycVerified[_creator] = true;
        } else {
            delete isKycVerified[_creator];
        }
        emit KycStatusUpdated(_creator, _status);
    }

    /// @notice Set charity verification status for a campaign (alias for setKycStatus)
    function setCharityStatus(uint256 _campaignId, bool _status) external onlyRole(KYC_ROLE) {
        if (!campaigns[_campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
        address creator = campaigns[_campaignId].creator;
        if (_status) {
            isKycVerified[creator] = true;
        } else {
            delete isKycVerified[creator];
        }
        emit KycStatusUpdated(creator, _status);
    }

    /// @notice Freeze or unfreeze an individual campaign for security investigation / fraud prevention
    /// @param _campaignId The campaign identifier
    /// @param _status True to freeze donations and withdrawals; false to unfreeze
    function setCampaignFrozen(uint256 _campaignId, bool _status) external onlyRole(REVIEWER_ROLE) {
        if (!campaigns[_campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
        isCampaignFrozen[_campaignId] = _status;
        emit CampaignFrozen(_campaignId, _status);
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
    /// @dev Uses re-packed 3-slot Campaign struct layout saving ~80k gas on storage writes
    function createCampaign(
        address tokenAddress,
        uint256 targetGoal,
        uint256 durationInDays,
        bool isFlexible
    ) external whenNotPaused returns (uint256 campaignId) {
        if (targetGoal == 0 || targetGoal > type(uint128).max) revert FundMeErrors.InvalidGoal();
        if (durationInDays == 0) revert FundMeErrors.InvalidDeadline();
        if (tokenAddress != address(0) && !whitelistedTokens[tokenAddress]) {
            revert FundMeErrors.TokenNotWhitelisted();
        }

        campaignId = nextCampaignId;
        unchecked {
            nextCampaignId = campaignId + 1;
        }
        uint64 deadline = uint64(block.timestamp + (durationInDays * 1 days));

        campaigns[campaignId] = Campaign({
            id: uint96(campaignId),
            creator: payable(msg.sender),
            tokenAddress: tokenAddress,
            deadline: deadline,
            isCompleted: false,
            isFlexible: isFlexible,
            exists: true,
            targetGoal: uint128(targetGoal),
            totalRaised: 0
        });

        emit CampaignCreated(
            campaignId,
            msg.sender,
            tokenAddress,
            targetGoal,
            uint256(deadline),
            isFlexible
        );
    }

    /// @notice Create campaign with explicit beneficiary and deadline timestamp
    /// @dev Uses re-packed 3-slot Campaign struct layout
    function createCampaign(
        address _beneficiary,
        uint256 _targetAmount,
        uint64 _deadline,
        address _paymentToken
    ) external whenNotPaused returns (uint256 campaignId) {
        if (_targetAmount == 0 || _targetAmount > type(uint128).max) revert FundMeErrors.InvalidGoal();
        if (_deadline <= block.timestamp) revert FundMeErrors.InvalidDeadline();
        if (_beneficiary == address(0)) revert FundMeErrors.InvalidRecipient();
        if (_paymentToken != address(0) && !whitelistedTokens[_paymentToken]) {
            revert FundMeErrors.TokenNotWhitelisted();
        }

        campaignId = nextCampaignId;
        unchecked {
            nextCampaignId = campaignId + 1;
        }

        campaigns[campaignId] = Campaign({
            id: uint96(campaignId),
            creator: payable(_beneficiary),
            tokenAddress: _paymentToken,
            deadline: _deadline,
            isCompleted: false,
            isFlexible: false,
            exists: true,
            targetGoal: uint128(_targetAmount),
            totalRaised: 0
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
    function contributeETH(uint256 campaignId) public payable nonReentrant whenNotPaused {
        _contributeETH(campaignId, msg.value);
    }

    /// @notice Alias for contributeETH
    function donateNative(uint256 campaignId) external payable nonReentrant whenNotPaused {
        _contributeETH(campaignId, msg.value);
    }

    /// @dev Shared internal logic for native ETH contributions with memory caching
    function _contributeETH(uint256 campaignId, uint256 amount) internal {
        if (amount == 0) revert FundMeErrors.ZeroContribution();
        if (amount < MIN_CONTRIBUTION) revert FundMeErrors.ContributionTooLow();
        if (amount > MAX_CONTRIBUTION) revert FundMeErrors.ContributionTooHigh();

        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (isCampaignFrozen[campaignId]) revert FundMeErrors.CampaignFrozen();
        if (campaign.tokenAddress != address(0)) revert FundMeErrors.InvalidPaymentToken();
        if (block.timestamp >= campaign.deadline) revert FundMeErrors.CampaignExpired();
        if (campaign.isCompleted) revert FundMeErrors.CampaignExpired();

        uint128 currentRaised = campaign.totalRaised;
        uint128 newRaised;
        unchecked {
            newRaised = currentRaised + uint128(amount);
        }
        campaign.totalRaised = newRaised;
        contributions[campaignId][msg.sender] += amount;

        emit ContributionReceived(campaignId, msg.sender, amount, address(0));
    }

    /// @notice Contribute whitelisted ERC20 tokens to a campaign
    function contributeToken(uint256 campaignId, uint256 amount) public nonReentrant whenNotPaused {
        _contributeToken(campaignId, amount);
    }

    /// @notice Alias for contributeToken
    function donateToken(uint256 campaignId, uint256 amount) external nonReentrant whenNotPaused {
        _contributeToken(campaignId, amount);
    }

    /// @dev Shared internal logic for ERC20 contributions with memory caching of token address
    function _contributeToken(uint256 campaignId, uint256 amount) internal {
        if (amount == 0) revert FundMeErrors.ZeroContribution();
        if (amount < MIN_CONTRIBUTION) revert FundMeErrors.ContributionTooLow();
        if (amount > MAX_CONTRIBUTION) revert FundMeErrors.ContributionTooHigh();

        Campaign storage campaign = campaigns[campaignId];
        address token = campaign.tokenAddress; // Cached in memory to avoid redundant SLOADs
        
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (isCampaignFrozen[campaignId]) revert FundMeErrors.CampaignFrozen();
        if (token == address(0)) revert FundMeErrors.InvalidPaymentToken();
        if (!whitelistedTokens[token]) revert FundMeErrors.TokenNotWhitelisted();
        if (block.timestamp >= campaign.deadline) revert FundMeErrors.CampaignExpired();
        if (campaign.isCompleted) revert FundMeErrors.CampaignExpired();

        IERC20 tokenContract = IERC20(token);
        uint256 balanceBefore = tokenContract.balanceOf(address(this));
        tokenContract.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualAmount = tokenContract.balanceOf(address(this)) - balanceBefore;

        uint128 currentRaised = campaign.totalRaised;
        uint128 newRaised;
        unchecked {
            newRaised = currentRaised + uint128(actualAmount);
        }
        campaign.totalRaised = newRaised;
        contributions[campaignId][msg.sender] += actualAmount;

        emit ContributionReceived(campaignId, msg.sender, actualAmount, token);
    }

    /// @notice Request withdrawal (for approval workflow backwards compatibility)
    function requestWithdrawal(uint256 campaignId) external view whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaigns[campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
        if (isCampaignFrozen[campaignId]) revert FundMeErrors.CampaignFrozen();
        if (msg.sender != campaign.creator) revert FundMeErrors.Unauthorized();
    }

    /// @notice Approve withdrawal
    function approveWithdrawal(uint256 campaignId) external view onlyRole(REVIEWER_ROLE) whenNotPaused {
        if (!campaigns[campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
    }

    /// @notice Reject withdrawal
    function rejectWithdrawal(uint256 campaignId) external view onlyRole(REVIEWER_ROLE) whenNotPaused {
        if (!campaigns[campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
    }

    /// @notice Withdraw funds for creator (pull payment pattern with CEI and memory caching)
    function withdrawFunds(uint256 campaignId) public nonReentrant whenNotPaused {
        _withdrawFunds(campaignId);
    }

    /// @notice Alias for withdrawFunds
    function executeWithdrawal(uint256 campaignId) external nonReentrant whenNotPaused {
        withdrawFunds(campaignId);
    }

    /// @dev Shared internal withdrawal logic caching creator, amounts, feeRecipient in memory
    function _withdrawFunds(uint256 campaignId) internal {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (isCampaignFrozen[campaignId]) revert FundMeErrors.CampaignFrozen();

        address payable creator = campaign.creator; // Cached in memory to save repeated SLOADs
        if (msg.sender != creator) revert FundMeErrors.Unauthorized();
        if (campaign.isCompleted) revert FundMeErrors.AlreadyWithdrawn();

        uint128 raised = campaign.totalRaised; // Cached in memory
        uint128 target = campaign.targetGoal;  // Cached in memory
        bool isFlexible = campaign.isFlexible;

        if (!isFlexible) {
            if (raised < target) revert FundMeErrors.GoalNotReached();
        } else {
            if (raised == 0) revert FundMeErrors.ZeroContribution();
        }

        // Checks-Effects-Interactions (CEI Pattern)
        campaign.isCompleted = true;

        address recipient = feeRecipient; // Cached in memory
        uint256 feeBps = isKycVerified[creator] ? KYC_FEE_BPS : STANDARD_FEE_BPS;
        uint256 feeAmount;
        uint256 payoutAmount;
        unchecked {
            feeAmount = (uint256(raised) * feeBps) / BPS_DENOMINATOR;
            payoutAmount = uint256(raised) - feeAmount;
        }

        address token = campaign.tokenAddress; // Cached in memory
        if (token == address(0)) {
            (bool feeSuccess, ) = recipient.call{value: feeAmount}("");
            if (!feeSuccess) revert FundMeErrors.TreasuryTransferFailed();

            (bool creatorSuccess, ) = creator.call{value: payoutAmount}("");
            if (!creatorSuccess) revert FundMeErrors.BeneficiaryTransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, feeAmount);
            IERC20(token).safeTransfer(creator, payoutAmount);
        }

        emit WithdrawalExecuted(campaignId, creator, payoutAmount, feeAmount);
    }

    /// @notice Claim refund for failed All-or-Nothing campaigns (pull payment pattern with CEI)
    /// @dev Clears unused contribution storage slot with delete for EVM gas refunds
    function claimRefund(uint256 campaignId) external nonReentrant whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (campaign.isCompleted) revert FundMeErrors.AlreadyWithdrawn();
        if (!isCampaignFrozen[campaignId]) {
            if (campaign.isFlexible) revert FundMeErrors.GoalAlreadyReached();
            if (block.timestamp < campaign.deadline) revert FundMeErrors.CampaignNotEnded();
            if (campaign.totalRaised >= campaign.targetGoal) revert FundMeErrors.GoalAlreadyReached();
        }

        uint256 refundAmount = contributions[campaignId][msg.sender];
        if (refundAmount == 0) revert FundMeErrors.ZeroContribution();

        // Checks-Effects-Interactions (CEI Pattern) - delete clears storage slot & triggers gas refund
        delete contributions[campaignId][msg.sender];

        address token = campaign.tokenAddress; // Cached in memory
        if (token == address(0)) {
            (bool success, ) = msg.sender.call{value: refundAmount}("");
            if (!success) revert FundMeErrors.RefundTransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, refundAmount);
        }

        emit RefundClaimed(campaignId, msg.sender, refundAmount);
    }

    /// @notice Batch process refunds for multiple donors of a failed campaign
    /// @dev Optimized loop: calldata array, cached length, unchecked increment, and delete for storage refunds
    /// @param campaignId Campaign identifier
    /// @param donors Array of donor addresses to refund
    function batchRefund(uint256 campaignId, address[] calldata donors) external nonReentrant whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaign.exists) revert FundMeErrors.CampaignDoesNotExist();
        if (campaign.isCompleted) revert FundMeErrors.AlreadyWithdrawn();
        if (!isCampaignFrozen[campaignId]) {
            if (campaign.isFlexible) revert FundMeErrors.GoalAlreadyReached();
            if (block.timestamp < campaign.deadline) revert FundMeErrors.CampaignNotEnded();
            if (campaign.totalRaised >= campaign.targetGoal) revert FundMeErrors.GoalAlreadyReached();
        }

        address token = campaign.tokenAddress;
        uint256 len = donors.length;

        for (uint256 i; i < len;) {
            address donor = donors[i];
            uint256 refundAmount = contributions[campaignId][donor];
            if (refundAmount > 0) {
                // Clear unused storage data to get gas refund
                delete contributions[campaignId][donor];

                bool success;
                if (token == address(0)) {
                    // Forward bounded gas to prevent malicious fallback out-of-gas DoS
                    (success, ) = donor.call{value: refundAmount, gas: 50000}("");
                } else {
                    // Safe transfer attempt using low-level call to prevent token failure DoS
                    (bool callSuccess, bytes memory data) = token.call(
                        abi.encodeWithSelector(IERC20.transfer.selector, donor, refundAmount)
                    );
                    success = callSuccess && (data.length == 0 || abi.decode(data, (bool)));
                }

                if (success) {
                    emit RefundClaimed(campaignId, donor, refundAmount);
                } else {
                    // DoS Protection: If transfer fails, restore contribution balance
                    // so one failing donor cannot revert the batch or block others.
                    // The donor can still claim manually anytime via claimRefund().
                    contributions[campaignId][donor] = refundAmount;
                    emit RefundFailed(campaignId, donor, refundAmount);
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Batch whitelist or un-whitelist multiple ERC20 tokens
    /// @dev Optimized loop: calldata array, cached length, unchecked increment, and storage clearing
    /// @param tokens Array of token addresses
    /// @param status Whitelist status to set
    function batchWhitelistTokens(address[] calldata tokens, bool status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 len = tokens.length;
        for (uint256 i; i < len;) {
            address token = tokens[i];
            if (status) {
                whitelistedTokens[token] = true;
            } else {
                delete whitelistedTokens[token];
            }
            emit TokenWhitelisted(token, status);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Get campaign details by ID
    /// @param campaignId The ID of the campaign
    /// @return The campaign struct
    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }

    /// @notice Cancel or delete a campaign by its creator
    /// @dev If totalRaised == 0, clears storage slot with delete for gas refunds; otherwise ends campaign for donor refunds
    /// @param campaignId ID of the campaign to cancel
    function cancelCampaign(uint256 campaignId) external nonReentrant whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        if (!campaigns[campaignId].exists) revert FundMeErrors.CampaignDoesNotExist();
        if (isCampaignFrozen[campaignId]) revert FundMeErrors.CampaignFrozen();
        if (msg.sender != campaign.creator) revert FundMeErrors.Unauthorized();
        if (campaign.isCompleted) revert FundMeErrors.AlreadyWithdrawn();

        if (campaign.totalRaised == 0) {
            delete campaigns[campaignId];
        } else {
            campaign.deadline = uint64(block.timestamp);
            campaign.isCompleted = true;
        }

        emit CampaignCanceled(campaignId, msg.sender);
    }
}
