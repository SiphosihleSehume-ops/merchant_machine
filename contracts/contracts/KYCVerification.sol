// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title KYCVerification
 * @notice On-chain registry of KYC-approved wallets for Merchant Machine.
 *
 * Only the verification status and timestamp are stored. Identity documents, names,
 * ID numbers and addresses NEVER go on-chain: they stay (encrypted) with the off-chain
 * verifier. Any application can call isVerified(wallet) to check a wallet's status.
 */
contract KYCVerification {
    address public owner;

    struct Verification {
        bool isVerified;
        uint256 verifiedAt;
    }

    mapping(address => Verification) public verifications;

    event WalletVerified(address indexed wallet, uint256 verifiedAt);
    event VerificationRevoked(address indexed wallet, uint256 revokedAt);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    /// @notice Marks a wallet as KYC-approved (called by the verifier after review).
    function verify(address wallet) external onlyOwner {
        require(wallet != address(0), "Invalid wallet");
        verifications[wallet] = Verification({isVerified: true, verifiedAt: block.timestamp});
        emit WalletVerified(wallet, block.timestamp);
    }

    /// @notice Removes a wallet's approval (e.g. fraud, expired documents).
    function revoke(address wallet) external onlyOwner {
        require(verifications[wallet].isVerified, "Not verified");
        verifications[wallet] = Verification({isVerified: false, verifiedAt: 0});
        emit VerificationRevoked(wallet, block.timestamp);
    }

    /// @notice Public check for other applications.
    function isVerified(address wallet) external view returns (bool verified, uint256 verifiedAt) {
        Verification memory v = verifications[wallet];
        return (v.isVerified, v.verifiedAt);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
