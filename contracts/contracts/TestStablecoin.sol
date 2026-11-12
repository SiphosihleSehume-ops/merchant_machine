// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/**
 * @title TestStablecoin
 * @notice TESTNET-ONLY fiat-pegged token used by Merchant Machine (ZARK, USDC mock, NGN).
 *
 * Mimics Circle's USDC surface that x402 relies on:
 *  - 6 decimals
 *  - EIP-2612 permit
 *  - EIP-3009 transferWithAuthorization / receiveWithAuthorization / cancelAuthorization,
 *    in both (v, r, s) and `bytes signature` forms (the latter also accepts ERC-1271 wallets)
 *  - name() and version() matching the EIP-712 domain
 *
 * Plus a rate-limited public faucet so customers can fund test wallets.
 * There is no reserve backing these tokens: do NOT deploy to mainnet.
 */
contract TestStablecoin is ERC20, EIP712, Nonces, IERC20Permit, Ownable {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    /// @dev authorizer => nonce => used/cancelled
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    uint256 public faucetAmount;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    mapping(address => uint256) public lastFaucetAt;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);
    event FaucetAmountUpdated(uint256 amount);

    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error InvalidSignature();
    error CallerMustBePayee();
    error FaucetCooldown(uint256 availableAt);
    error FaucetDisabled();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory version_,
        uint256 faucetAmount_,
        address initialOwner
    ) ERC20(name_, symbol_) EIP712(name_, version_) Ownable(initialOwner) {
        // EIP712 is initialised directly (not via OZ ERC20Permit, which pins version "1")
        // so permit and EIP-3009 share one domain with a configurable version (USDC uses "2").
        faucetAmount = faucetAmount_;
    }

    // ------------------------------------------------------------------
    // Metadata
    // ------------------------------------------------------------------

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice EIP-712 domain version (read by x402 facilitators).
    function version() external view returns (string memory) {
        return _EIP712Version();
    }

    // ------------------------------------------------------------------
    // EIP-2612 permit
    // ------------------------------------------------------------------

    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    error ERC2612ExpiredSignature(uint256 deadline);
    error ERC2612InvalidSigner(address signer, address owner);

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp > deadline) revert ERC2612ExpiredSignature(deadline);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (signer != owner) revert ERC2612InvalidSigner(signer, owner);
        _approve(owner, spender, value);
    }

    function nonces(address owner) public view override(IERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------
    // Owner / faucet
    // ------------------------------------------------------------------

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setFaucetAmount(uint256 amount) external onlyOwner {
        faucetAmount = amount;
        emit FaucetAmountUpdated(amount);
    }

    /// @notice Mints `faucetAmount` to the caller, at most once per FAUCET_COOLDOWN.
    function faucet() external {
        if (faucetAmount == 0) revert FaucetDisabled();
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
    }

    // ------------------------------------------------------------------
    // EIP-3009
    // ------------------------------------------------------------------

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v));
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) public {
        _useAuthorization(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature);
        _transfer(from, to, value);
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        receiveWithAuthorization(from, to, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v));
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) public {
        if (to != msg.sender) revert CallerMustBePayee();
        _useAuthorization(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature);
        _transfer(from, to, value);
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        cancelAuthorization(authorizer, nonce, abi.encodePacked(r, s, v));
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, bytes memory signature) public {
        if (_authorizationStates[authorizer][nonce]) revert AuthorizationAlreadyUsed();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)));
        if (!SignatureChecker.isValidSignatureNow(authorizer, digest, signature)) revert InvalidSignature();
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function _useAuthorization(
        bytes32 typehash,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) private {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (_authorizationStates[from][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(typehash, from, to, value, validAfter, validBefore, nonce))
        );
        if (!SignatureChecker.isValidSignatureNow(from, digest, signature)) revert InvalidSignature();

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }
}
