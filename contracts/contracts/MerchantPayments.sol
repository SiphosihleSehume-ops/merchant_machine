// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MerchantPayments
 * @notice Pays a Merchant Machine invoice in one transaction and collects the platform fee.
 *
 * The customer pays the invoice total. The fee is deducted from the merchant's side:
 *   merchant receives amount - fee, platform treasury receives fee (feeBps / 10_000).
 *
 * Works with any ERC-20 (no EIP-3009 needed). The payer approves this contract once;
 * pay() only ever pulls from msg.sender, so an approval can't be used by anyone else.
 * Each PaymentMade event carries the invoice reference the backend verifies.
 */
contract MerchantPayments is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 1_000; // hard cap: 10%

    address public owner;
    address public treasury;
    uint16 public feeBps;

    event PaymentMade(
        bytes32 indexed invoiceRef,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount,
        uint256 fee
    );
    event FeeUpdated(uint16 feeBps);
    event TreasuryUpdated(address treasury);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor(address treasury_, uint16 feeBps_) {
        require(treasury_ != address(0), "Invalid treasury");
        require(feeBps_ <= MAX_FEE_BPS, "Fee too high");
        owner = msg.sender;
        treasury = treasury_;
        feeBps = feeBps_;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Fee taken from `amount` at the current rate (rounded down, in the merchant's favour).
    function feeFor(uint256 amount) public view returns (uint256) {
        return (amount * feeBps) / 10_000;
    }

    /**
     * @notice Pays `amount` of `token` for an invoice: `amount - fee` to `merchant`, `fee` to treasury.
     * @param invoiceRef keccak256 of the invoice id (lets the backend match the payment)
     */
    function pay(IERC20 token, address merchant, uint256 amount, bytes32 invoiceRef) external nonReentrant {
        require(merchant != address(0), "Invalid merchant");
        require(amount > 0, "Amount is zero");

        uint256 fee = feeFor(amount);
        token.safeTransferFrom(msg.sender, merchant, amount - fee);
        if (fee > 0) token.safeTransferFrom(msg.sender, treasury, fee);

        emit PaymentMade(invoiceRef, msg.sender, merchant, address(token), amount, fee);
    }

    function setFeeBps(uint16 feeBps_) external onlyOwner {
        require(feeBps_ <= MAX_FEE_BPS, "Fee too high");
        feeBps = feeBps_;
        emit FeeUpdated(feeBps_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "Invalid treasury");
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
