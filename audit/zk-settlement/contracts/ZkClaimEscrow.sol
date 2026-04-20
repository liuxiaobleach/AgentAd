// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./IProofVerifier.sol";
import "./EpochRegistry.sol";

/// @title ZkClaimEscrow
/// @notice Parallel-to-BudgetEscrow vault that settles publisher earnings
///         using a zkVM proof instead of a signed receipt. Deposits remain the
///         same (advertisers `deposit()` USDC); the difference is in the
///         claim path:
///
///             claim(publicInputs, proof)
///               ├─ verifier.verify(publicInputs, proof) == true
///               ├─ registry.rootOf(epochId) == publicInputs.log_root
///               ├─ (publisher, epochId) not already claimed
///               └─ transfer amount_claim USDC to publisher
///
/// The platform never signs a receipt. The only trust assumption is that the
/// EpochRegistry committed the correct root — which is itself auditable
/// because any node with access to SDK verify logs can reconstruct the leaf
/// set and compare.
contract ZkClaimEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Dependencies
    // ---------------------------------------------------------------------
    IERC20          public immutable token;
    IProofVerifier  public verifier;
    EpochRegistry   public registry;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------
    // epochId => publisher => claimed?
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(address => uint256) public totalClaimed;
    mapping(address => uint256) public deposits;
    uint256 public totalDeposited;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event Deposited(address indexed advertiser, uint256 amount);
    event Claimed(address indexed publisher, uint256 indexed epochId, uint256 amount, bytes32 logRoot);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event RegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------
    constructor(
        address tokenAddress,
        address initialOwner,
        IProofVerifier initialVerifier,
        EpochRegistry initialRegistry
    ) Ownable(initialOwner) {
        require(tokenAddress != address(0), "token zero");
        require(address(initialVerifier) != address(0), "verifier zero");
        require(address(initialRegistry) != address(0), "registry zero");
        token = IERC20(tokenAddress);
        verifier = initialVerifier;
        registry = initialRegistry;
        emit VerifierUpdated(address(0), address(initialVerifier));
        emit RegistryUpdated(address(0), address(initialRegistry));
    }

    // ---------------------------------------------------------------------
    // Deposit side (mirrors BudgetEscrow)
    // ---------------------------------------------------------------------
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "amount zero");
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        require(received > 0, "no tokens received");

        deposits[msg.sender] += received;
        totalDeposited += received;
        emit Deposited(msg.sender, received);
    }

    // ---------------------------------------------------------------------
    // Claim side (zk-verified)
    // ---------------------------------------------------------------------

    /// @notice Redeem earnings using a Pico zkVM proof. `publicInputs` MUST
    ///         be the exact byte sequence the guest committed (see
    ///         host/publicinputs.go::EncodePublicInputs for the layout).
    function claim(bytes calldata publicInputs, bytes calldata proof)
        external
        nonReentrant
    {
        (uint64 epochId, address publisher, uint128 amount, bytes32 logRoot, address currency)
            = _decodePublicInputs(publicInputs);

        require(publisher != address(0), "publisher zero");
        require(currency == address(token), "currency mismatch");
        require(amount > 0, "amount zero");
        require(!claimed[epochId][publisher], "already claimed");

        // The registry reverts if the epoch isn't finalized — so we don't
        // need an explicit "epoch known" check.
        bytes32 committedRoot = registry.rootOf(epochId);
        require(committedRoot == logRoot, "root mismatch");

        require(verifier.verify(publicInputs, proof), "bad proof");

        claimed[epochId][publisher] = true;
        totalClaimed[publisher] += amount;
        token.safeTransfer(publisher, amount);

        emit Claimed(publisher, epochId, amount, logRoot);
    }

    /// @notice View helper used by frontends before submitting a claim.
    function canClaim(uint256 epochId, address publisher) external view returns (bool) {
        if (claimed[epochId][publisher]) return false;
        (, , bool finalized) = registry.commitmentOf(epochId);
        return finalized;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------
    function setVerifier(IProofVerifier newVerifier) external onlyOwner {
        require(address(newVerifier) != address(0), "verifier zero");
        address old = address(verifier);
        verifier = newVerifier;
        emit VerifierUpdated(old, address(newVerifier));
    }

    function setRegistry(EpochRegistry newRegistry) external onlyOwner {
        require(address(newRegistry) != address(0), "registry zero");
        address old = address(registry);
        registry = newRegistry;
        emit RegistryUpdated(old, address(newRegistry));
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /// @dev Decodes the 96-byte public-input blob emitted by the guest.
    ///      Layout (big-endian, fixed-width):
    ///        [0..8)   epoch_id         uint64
    ///        [8..28)  publisher        address
    ///        [28..44) amount_claim     uint128
    ///        [44..76) log_root         bytes32
    ///        [76..96) currency         address
    function _decodePublicInputs(bytes calldata b)
        internal
        pure
        returns (uint64 epochId, address publisher, uint128 amount, bytes32 logRoot, address currency)
    {
        require(b.length == 96, "bad public inputs length");

        // uint64 BE
        uint64 e;
        for (uint256 i = 0; i < 8; i++) {
            e = (e << 8) | uint64(uint8(b[i]));
        }
        epochId = e;

        // address (20 bytes) BE → rightmost 20 bytes of an address word
        publisher = address(bytes20(b[8:28]));

        // uint128 BE (16 bytes)
        uint128 a;
        for (uint256 i = 28; i < 44; i++) {
            a = (a << 8) | uint128(uint8(b[i]));
        }
        amount = a;

        logRoot = bytes32(b[44:76]);
        currency = address(bytes20(b[76:96]));
    }
}
