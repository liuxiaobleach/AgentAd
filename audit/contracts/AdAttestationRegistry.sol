// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract AdAttestationRegistry is Ownable {
    struct AdAttestation {
        bytes32 attestationId;
        bytes32 creativeHash;
        bytes32 destinationHash;
        bytes32 placementDomainHash;
        bytes32 policyVersionHash;
        uint256 issuedAt;
        uint256 expiresAt;
        address issuer;
        uint8 status; // 0=Unknown, 1=Active, 2=Revoked, 3=Expired
        string reportCID;
    }

    mapping(bytes32 => AdAttestation) public attestations;
    mapping(address => bool) public authorizedIssuers;

    event AttestationIssued(
        bytes32 indexed attestationId,
        bytes32 creativeHash,
        bytes32 destinationHash,
        address issuer,
        uint256 expiresAt
    );

    event AttestationRevoked(
        bytes32 indexed attestationId,
        string reason
    );

    modifier onlyAuthorized() {
        require(
            authorizedIssuers[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        _;
    }

    constructor() Ownable(msg.sender) {
        authorizedIssuers[msg.sender] = true;
    }

    function addIssuer(address issuer) external onlyOwner {
        authorizedIssuers[issuer] = true;
    }

    function removeIssuer(address issuer) external onlyOwner {
        authorizedIssuers[issuer] = false;
    }

    function issueAttestation(
        bytes32 attestationId,
        bytes32 creativeHash,
        bytes32 destinationHash,
        bytes32 placementDomainHash,
        bytes32 policyVersionHash,
        uint256 expiresAt,
        string calldata reportCID
    ) external onlyAuthorized {
        require(
            attestations[attestationId].status == 0,
            "Attestation already exists"
        );
        require(expiresAt > block.timestamp, "Expiry must be in the future");

        attestations[attestationId] = AdAttestation({
            attestationId: attestationId,
            creativeHash: creativeHash,
            destinationHash: destinationHash,
            placementDomainHash: placementDomainHash,
            policyVersionHash: policyVersionHash,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            issuer: msg.sender,
            status: 1, // Active
            reportCID: reportCID
        });

        emit AttestationIssued(
            attestationId,
            creativeHash,
            destinationHash,
            msg.sender,
            expiresAt
        );
    }

    function revokeAttestation(
        bytes32 attestationId,
        string calldata reason
    ) external onlyAuthorized {
        require(
            attestations[attestationId].status == 1,
            "Attestation not active"
        );

        attestations[attestationId].status = 2; // Revoked

        emit AttestationRevoked(attestationId, reason);
    }

    function getAttestation(
        bytes32 attestationId
    ) external view returns (AdAttestation memory) {
        return attestations[attestationId];
    }

    function verifyAttestation(
        bytes32 attestationId,
        bytes32 creativeHash,
        bytes32 destinationHash
    ) external view returns (bool valid, uint8 status, string memory reason) {
        AdAttestation memory att = attestations[attestationId];

        if (att.status == 0) {
            return (false, 0, "Attestation not found");
        }
        if (att.status == 2) {
            return (false, 2, "Attestation revoked");
        }
        if (block.timestamp > att.expiresAt) {
            return (false, 3, "Attestation expired");
        }
        if (att.creativeHash != creativeHash) {
            return (false, 1, "Creative hash mismatch");
        }
        if (att.destinationHash != destinationHash) {
            return (false, 1, "Destination hash mismatch");
        }

        return (true, 1, "Valid");
    }
}
