// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title BudgetEscrow
/// @notice Holds advertiser ad-budget (USDC) on-chain and lets publishers
///         redeem earnings via EIP-712 signed receipts issued by the platform.
///         M1 design: funds are pooled. The issuer (backend signer) attests
///         to each publisher's cumulative earnings off-chain; the contract
///         enforces signature validity, receipt uniqueness, and expiry.
contract BudgetEscrow is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Deposit side (advertisers)
    // ---------------------------------------------------------------------
    IERC20 public immutable token;
    mapping(address => uint256) public deposits;
    uint256 public totalDeposited;

    // ---------------------------------------------------------------------
    // Claim side (publishers)
    // ---------------------------------------------------------------------
    address public issuer;
    mapping(bytes32 => bool) public usedReceipts;
    mapping(address => uint256) public totalClaimed;

    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "ClaimReceipt(address publisher,uint256 amount,bytes32 receiptId,uint256 expiry)"
    );

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event Deposited(address indexed advertiser, uint256 amount, uint256 timestamp);
    event Refunded(address indexed advertiser, uint256 amount, address indexed operator);
    event Swept(address indexed to, uint256 amount, address indexed operator);
    event TokenRecovered(address indexed otherToken, address indexed to, uint256 amount);
    event Claimed(address indexed publisher, uint256 amount, bytes32 indexed receiptId);
    event IssuerUpdated(address indexed oldIssuer, address indexed newIssuer);

    constructor(address tokenAddress, address initialOwner, address initialIssuer)
        Ownable(initialOwner)
        EIP712("AgentAdBudgetEscrow", "1")
    {
        require(tokenAddress != address(0), "token zero");
        require(initialOwner != address(0), "owner zero");
        require(initialIssuer != address(0), "issuer zero");
        token = IERC20(tokenAddress);
        issuer = initialIssuer;
        emit IssuerUpdated(address(0), initialIssuer);
    }

    // ---------------------------------------------------------------------
    // Advertiser deposit flow
    //   * Two-step: approve + deposit(amount)
    //   * One-step: depositWithPermit(amount, deadline, v, r, s) — uses
    //     EIP-2612 permit so no standalone approve tx is required.
    // ---------------------------------------------------------------------

    /// @notice Advertiser deposits ad budget. Must `approve` first.
    function deposit(uint256 amount) external nonReentrant {
        _pullAndCredit(msg.sender, amount);
    }

    /// @notice Advertiser deposits ad budget in a single transaction using an
    ///         EIP-2612 permit. Off-chain the advertiser signs a `Permit`
    ///         typed-data message (no gas); this function consumes it and
    ///         pulls tokens in one call, avoiding the separate approve tx.
    ///         If the token does not implement permit or the signature is
    ///         bad this will revert — callers can fall back to approve +
    ///         deposit(amount).
    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        // Best-effort permit: if the current allowance already covers `amount`
        // (e.g. token is non-permit and user pre-approved) we tolerate a
        // permit call that reverts. Otherwise we require it to succeed.
        try IERC20Permit(address(token)).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        ) {
            // permit applied
        } catch {
            require(
                token.allowance(msg.sender, address(this)) >= amount,
                "permit failed"
            );
        }

        _pullAndCredit(msg.sender, amount);
    }

    function _pullAndCredit(address advertiser, uint256 amount) internal {
        require(amount > 0, "amount zero");
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(advertiser, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        require(received > 0, "no tokens received");

        deposits[advertiser] += received;
        totalDeposited += received;
        emit Deposited(advertiser, received, block.timestamp);
    }

    function refund(address advertiser, uint256 amount) external onlyOwner nonReentrant {
        require(advertiser != address(0), "addr zero");
        require(amount > 0, "amount zero");
        token.safeTransfer(advertiser, amount);
        emit Refunded(advertiser, amount, msg.sender);
    }

    function sweep(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "addr zero");
        require(amount > 0, "amount zero");
        token.safeTransfer(to, amount);
        emit Swept(to, amount, msg.sender);
    }

    function recoverToken(address otherToken, address to, uint256 amount) external onlyOwner {
        require(otherToken != address(token), "use sweep");
        require(to != address(0), "addr zero");
        IERC20(otherToken).safeTransfer(to, amount);
        emit TokenRecovered(otherToken, to, amount);
    }

    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // ---------------------------------------------------------------------
    // Publisher claim flow (EIP-712 signed receipt)
    // ---------------------------------------------------------------------

    /// @notice Redeem earnings using a receipt signed by the issuer.
    /// @param publisher Wallet to receive USDC.
    /// @param amount    Atomic USDC to transfer.
    /// @param receiptId Unique id (nonce) per receipt; each id can be used once.
    /// @param expiry    Unix timestamp after which the receipt is invalid.
    /// @param signature EIP-712 signature produced by `issuer`.
    ///
    /// Anyone may submit the signature (relayable). The contract only
    /// guarantees: valid signer, not expired, not used. Off-chain ledger
    /// correctness is the issuer's responsibility.
    function claim(
        address publisher,
        uint256 amount,
        bytes32 receiptId,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        require(amount > 0, "amount zero");
        require(publisher != address(0), "publisher zero");
        require(block.timestamp <= expiry, "receipt expired");
        require(!usedReceipts[receiptId], "receipt used");

        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, publisher, amount, receiptId, expiry)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        require(signer == issuer, "bad signer");

        usedReceipts[receiptId] = true;
        totalClaimed[publisher] += amount;

        token.safeTransfer(publisher, amount);
        emit Claimed(publisher, amount, receiptId);
    }

    /// @notice Preview what digest will be signed for a given receipt.
    ///         Used by backend and frontend for debugging signatures.
    function claimDigest(
        address publisher,
        uint256 amount,
        bytes32 receiptId,
        uint256 expiry
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, publisher, amount, receiptId, expiry)
        );
        return _hashTypedDataV4(structHash);
    }

    function setIssuer(address newIssuer) external onlyOwner {
        require(newIssuer != address(0), "issuer zero");
        address old = issuer;
        issuer = newIssuer;
        emit IssuerUpdated(old, newIssuer);
    }

    /// @notice Expose EIP-712 domain separator for off-chain tooling.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
