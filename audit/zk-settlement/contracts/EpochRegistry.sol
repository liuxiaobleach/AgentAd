// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title EpochRegistry
/// @notice On-chain commitment of per-epoch impression-log Merkle roots.
///         Off-chain, the backend aggregates impressions, builds a Merkle tree
///         over them (sorted-pair SHA-256, see host/merkle.go), and calls
///         `commit(epochId, root)` exactly once per epoch.
///
///         ZkClaimEscrow reads back the committed root when verifying a
///         publisher's proof. This separation is deliberate: the escrow
///         doesn't need to know how epochs are chosen or who can commit them,
///         only that a given root was attested for a given epoch.
///
/// @dev This contract is intentionally small — the goal is to keep the trust
///      surface of "what was the committed log for epoch N" as minimal and
///      auditable as possible.
contract EpochRegistry is Ownable {
    struct Commitment {
        bytes32 root;
        uint64  committedAt; // block timestamp when committed
        bool    finalized;   // once true, root is immutable (see seal())
    }

    mapping(uint256 => Commitment) private _commitments;
    address public committer; // off-chain operator account that calls commit()

    /// @notice Delay (seconds) between commit and when the root becomes
    ///         usable by the escrow. Gives auditors a window to dispute.
    uint64 public finalizationDelay;

    event CommitterUpdated(address indexed oldCommitter, address indexed newCommitter);
    event RootCommitted(uint256 indexed epochId, bytes32 root, uint64 committedAt);
    event RootFinalized(uint256 indexed epochId, bytes32 root);
    event RootRevoked(uint256 indexed epochId, bytes32 oldRoot);
    event FinalizationDelayUpdated(uint64 oldDelay, uint64 newDelay);

    constructor(address initialOwner, address initialCommitter, uint64 initialDelay)
        Ownable(initialOwner)
    {
        require(initialOwner != address(0), "owner zero");
        require(initialCommitter != address(0), "committer zero");
        committer = initialCommitter;
        finalizationDelay = initialDelay;
        emit CommitterUpdated(address(0), initialCommitter);
        emit FinalizationDelayUpdated(0, initialDelay);
    }

    modifier onlyCommitter() {
        require(msg.sender == committer, "not committer");
        _;
    }

    /// @notice Publish the Merkle root for an epoch. Can only be called once
    ///         per epoch unless the owner revokes it first.
    function commit(uint256 epochId, bytes32 root) external onlyCommitter {
        require(root != bytes32(0), "root zero");
        require(_commitments[epochId].root == bytes32(0), "already committed");
        _commitments[epochId] = Commitment({
            root: root,
            committedAt: uint64(block.timestamp),
            finalized: false
        });
        emit RootCommitted(epochId, root, uint64(block.timestamp));
    }

    /// @notice Seal a commitment so ZkClaimEscrow will accept proofs against
    ///         it. Anyone may call once the finalization delay has passed —
    ///         permissionless finalization keeps the committer from griefing
    ///         by never sealing.
    function seal(uint256 epochId) external {
        Commitment storage c = _commitments[epochId];
        require(c.root != bytes32(0), "not committed");
        require(!c.finalized, "already finalized");
        require(
            block.timestamp >= uint256(c.committedAt) + uint256(finalizationDelay),
            "too early"
        );
        c.finalized = true;
        emit RootFinalized(epochId, c.root);
    }

    /// @notice Owner escape hatch to revoke a bad commitment BEFORE it has
    ///         been finalized. Post-finalization, the root is immutable and
    ///         any dispute must be resolved off-chain.
    function revoke(uint256 epochId) external onlyOwner {
        Commitment storage c = _commitments[epochId];
        require(c.root != bytes32(0), "not committed");
        require(!c.finalized, "already finalized");
        emit RootRevoked(epochId, c.root);
        delete _commitments[epochId];
    }

    /// @notice Returns the finalized root for an epoch. Reverts if the epoch
    ///         is unknown or not yet finalized — callers (ZkClaimEscrow) rely
    ///         on the revert to gate claims.
    function rootOf(uint256 epochId) external view returns (bytes32) {
        Commitment storage c = _commitments[epochId];
        require(c.root != bytes32(0), "epoch not committed");
        require(c.finalized, "epoch not finalized");
        return c.root;
    }

    /// @notice View variant that never reverts. For frontends / indexers.
    function commitmentOf(uint256 epochId) external view returns (bytes32 root, uint64 committedAt, bool finalized) {
        Commitment storage c = _commitments[epochId];
        return (c.root, c.committedAt, c.finalized);
    }

    function setCommitter(address newCommitter) external onlyOwner {
        require(newCommitter != address(0), "committer zero");
        address old = committer;
        committer = newCommitter;
        emit CommitterUpdated(old, newCommitter);
    }

    function setFinalizationDelay(uint64 newDelay) external onlyOwner {
        uint64 old = finalizationDelay;
        finalizationDelay = newDelay;
        emit FinalizationDelayUpdated(old, newDelay);
    }
}
