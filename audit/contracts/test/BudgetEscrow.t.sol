// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BudgetEscrow.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract BudgetEscrowTest is Test {
    BudgetEscrow escrow;
    MockUSDC usdc;

    address owner = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address publisher = address(0xCAFE);

    uint256 issuerKey = 0xA11CE_B0B;
    address issuer;

    function setUp() public {
        issuer = vm.addr(issuerKey);
        usdc = new MockUSDC();
        escrow = new BudgetEscrow(address(usdc), owner, issuer);
        usdc.mint(alice, 1_000_000_000);
        usdc.mint(bob, 1_000_000_000);
    }

    // ---------------- deposit side ----------------

    function testDeposit() public {
        vm.startPrank(alice);
        usdc.approve(address(escrow), 500_000_000);
        escrow.deposit(500_000_000);
        vm.stopPrank();

        assertEq(escrow.deposits(alice), 500_000_000);
        assertEq(escrow.totalDeposited(), 500_000_000);
        assertEq(usdc.balanceOf(address(escrow)), 500_000_000);
    }

    function testDepositTwiceAccumulates() public {
        vm.startPrank(alice);
        usdc.approve(address(escrow), 300_000_000);
        escrow.deposit(100_000_000);
        escrow.deposit(200_000_000);
        vm.stopPrank();
        assertEq(escrow.deposits(alice), 300_000_000);
    }

    function testRefundByOwner() public {
        _depositAs(alice, 500_000_000);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(owner);
        escrow.refund(alice, 200_000_000);
        assertEq(usdc.balanceOf(alice), before + 200_000_000);
    }

    function testSweepByOwner() public {
        _depositAs(alice, 500_000_000);
        vm.prank(owner);
        escrow.sweep(bob, 300_000_000);
        assertEq(usdc.balanceOf(bob), 1_000_000_000 + 300_000_000);
    }

    // ---------------- claim side ----------------

    function testClaimWithValidReceipt() public {
        _depositAs(alice, 100_000_000); // fund pool
        (bytes32 receiptId, uint256 expiry, bytes memory sig) =
            _signReceipt(publisher, 10_000_000, keccak256("r1"), block.timestamp + 1 hours);

        uint256 before = usdc.balanceOf(publisher);
        escrow.claim(publisher, 10_000_000, receiptId, expiry, sig);
        assertEq(usdc.balanceOf(publisher), before + 10_000_000);
        assertEq(escrow.totalClaimed(publisher), 10_000_000);
        assertTrue(escrow.usedReceipts(receiptId));
    }

    function testClaimReplayReverts() public {
        _depositAs(alice, 100_000_000);
        (bytes32 receiptId, uint256 expiry, bytes memory sig) =
            _signReceipt(publisher, 10_000_000, keccak256("r2"), block.timestamp + 1 hours);
        escrow.claim(publisher, 10_000_000, receiptId, expiry, sig);

        vm.expectRevert(bytes("receipt used"));
        escrow.claim(publisher, 10_000_000, receiptId, expiry, sig);
    }

    function testClaimExpiredReverts() public {
        _depositAs(alice, 100_000_000);
        (bytes32 receiptId, uint256 expiry, bytes memory sig) =
            _signReceipt(publisher, 10_000_000, keccak256("r3"), block.timestamp + 1 hours);
        vm.warp(expiry + 1);
        vm.expectRevert(bytes("receipt expired"));
        escrow.claim(publisher, 10_000_000, receiptId, expiry, sig);
    }

    function testClaimBadSignerReverts() public {
        _depositAs(alice, 100_000_000);
        // Sign with wrong key
        uint256 wrongKey = 0xDEAD;
        bytes32 receiptId = keccak256("r4");
        uint256 expiry = block.timestamp + 1 hours;
        bytes32 digest = escrow.claimDigest(publisher, 10_000_000, receiptId, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(bytes("bad signer"));
        escrow.claim(publisher, 10_000_000, receiptId, expiry, sig);
    }

    function testSetIssuerOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        escrow.setIssuer(address(0x1234));

        address newIssuer = address(0x5678);
        vm.prank(owner);
        escrow.setIssuer(newIssuer);
        assertEq(escrow.issuer(), newIssuer);
    }

    // ---------------- helpers ----------------

    function _depositAs(address who, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(escrow), amount);
        escrow.deposit(amount);
        vm.stopPrank();
    }

    function _signReceipt(
        address pub,
        uint256 amount,
        bytes32 receiptId,
        uint256 expiry
    ) internal view returns (bytes32, uint256, bytes memory) {
        bytes32 digest = escrow.claimDigest(pub, amount, receiptId, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerKey, digest);
        return (receiptId, expiry, abi.encodePacked(r, s, v));
    }
}
