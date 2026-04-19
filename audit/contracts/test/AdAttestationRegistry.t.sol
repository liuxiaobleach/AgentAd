// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AdAttestationRegistry.sol";

contract AdAttestationRegistryTest is Test {
    AdAttestationRegistry registry;

    address owner = address(0xA11CE);
    address issuer = address(0x1550E8);
    address rando = address(0xBAD);

    bytes32 constant AID = bytes32(uint256(0xA77E57A7104));
    bytes32 constant CREATIVE = keccak256("creative");
    bytes32 constant DEST = keccak256("https://dest.example");
    bytes32 constant PLACEMENT = keccak256("publisher.com");
    bytes32 constant POLICY = keccak256("v1.0");

    function setUp() public {
        vm.prank(owner);
        registry = new AdAttestationRegistry();
        vm.prank(owner);
        registry.addIssuer(issuer);
    }

    function _issue(bytes32 id) internal {
        vm.prank(issuer);
        registry.issueAttestation(
            id,
            CREATIVE,
            DEST,
            PLACEMENT,
            POLICY,
            block.timestamp + 30 days,
            "ipfs://report"
        );
    }

    function testIssueSucceeds() public {
        _issue(AID);
        AdAttestationRegistry.AdAttestation memory a = registry.getAttestation(AID);
        assertEq(a.attestationId, AID);
        assertEq(a.creativeHash, CREATIVE);
        assertEq(a.status, 1);
        assertEq(a.issuer, issuer);
    }

    function testIssueRevertsOnDuplicate() public {
        _issue(AID);
        vm.prank(issuer);
        vm.expectRevert(bytes("Attestation already exists"));
        registry.issueAttestation(
            AID, CREATIVE, DEST, PLACEMENT, POLICY, block.timestamp + 30 days, "ipfs://report"
        );
    }

    function testIssueRevertsOnPastExpiry() public {
        vm.warp(10_000);
        vm.prank(issuer);
        vm.expectRevert(bytes("Expiry must be in the future"));
        registry.issueAttestation(
            AID, CREATIVE, DEST, PLACEMENT, POLICY, block.timestamp - 1, "ipfs://r"
        );
    }

    function testIssueRevertsWhenUnauthorized() public {
        vm.prank(rando);
        vm.expectRevert(bytes("Not authorized"));
        registry.issueAttestation(
            AID, CREATIVE, DEST, PLACEMENT, POLICY, block.timestamp + 1 days, ""
        );
    }

    function testOwnerCanIssue() public {
        vm.prank(owner);
        registry.issueAttestation(
            AID, CREATIVE, DEST, PLACEMENT, POLICY, block.timestamp + 1 days, ""
        );
        assertEq(registry.getAttestation(AID).status, 1);
    }

    function testRevoke() public {
        _issue(AID);
        vm.prank(issuer);
        registry.revokeAttestation(AID, "bad content");
        assertEq(registry.getAttestation(AID).status, 2);
    }

    function testRevokeRevertsIfNotActive() public {
        vm.prank(issuer);
        vm.expectRevert(bytes("Attestation not active"));
        registry.revokeAttestation(AID, "never existed");
    }

    function testRemoveIssuer() public {
        vm.prank(owner);
        registry.removeIssuer(issuer);
        vm.prank(issuer);
        vm.expectRevert(bytes("Not authorized"));
        registry.issueAttestation(
            AID, CREATIVE, DEST, PLACEMENT, POLICY, block.timestamp + 1 days, ""
        );
    }

    function testVerifyValid() public {
        _issue(AID);
        (bool ok, uint8 status, string memory reason) = registry.verifyAttestation(AID, CREATIVE, DEST);
        assertTrue(ok);
        assertEq(status, 1);
        assertEq(reason, "Valid");
    }

    function testVerifyNotFound() public view {
        (bool ok, uint8 status, string memory reason) = registry.verifyAttestation(AID, CREATIVE, DEST);
        assertFalse(ok);
        assertEq(status, 0);
        assertEq(reason, "Attestation not found");
    }

    function testVerifyRevoked() public {
        _issue(AID);
        vm.prank(issuer);
        registry.revokeAttestation(AID, "abuse");
        (bool ok, uint8 status, string memory reason) = registry.verifyAttestation(AID, CREATIVE, DEST);
        assertFalse(ok);
        assertEq(status, 2);
        assertEq(reason, "Attestation revoked");
    }

    function testVerifyExpired() public {
        _issue(AID);
        vm.warp(block.timestamp + 31 days);
        (bool ok, uint8 status, string memory reason) = registry.verifyAttestation(AID, CREATIVE, DEST);
        assertFalse(ok);
        assertEq(status, 3);
        assertEq(reason, "Attestation expired");
    }

    function testVerifyCreativeMismatch() public {
        _issue(AID);
        (bool ok, uint8 status, string memory reason) = registry.verifyAttestation(AID, keccak256("other"), DEST);
        assertFalse(ok);
        assertEq(status, 1);
        assertEq(reason, "Creative hash mismatch");
    }

    function testVerifyDestinationMismatch() public {
        _issue(AID);
        (bool ok, uint8 status, string memory reason) = registry.verifyAttestation(AID, CREATIVE, keccak256("other"));
        assertFalse(ok);
        assertEq(status, 1);
        assertEq(reason, "Destination hash mismatch");
    }
}
