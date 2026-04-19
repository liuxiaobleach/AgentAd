// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BudgetEscrow.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}

contract MockPermitUSDC is ERC20, ERC20Permit {
    constructor() ERC20("Mock Permit USDC", "pUSDC") ERC20Permit("Mock Permit USDC") {}
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

    // ---------------- depositWithPermit ----------------

    function testDepositWithPermit() public {
        MockPermitUSDC permitUsdc = new MockPermitUSDC();
        BudgetEscrow permitEscrow = new BudgetEscrow(address(permitUsdc), owner, issuer);

        uint256 userKey = 0xBEEFCAFE;
        address user = vm.addr(userKey);
        permitUsdc.mint(user, 1_000_000_000);

        uint256 amount = 250_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(
            permitUsdc,
            userKey,
            user,
            address(permitEscrow),
            amount,
            permitUsdc.nonces(user),
            deadline
        );

        vm.prank(user);
        permitEscrow.depositWithPermit(amount, deadline, v, r, s);

        assertEq(permitEscrow.deposits(user), amount);
        assertEq(permitEscrow.totalDeposited(), amount);
        assertEq(permitUsdc.balanceOf(address(permitEscrow)), amount);
        assertEq(permitUsdc.allowance(user, address(permitEscrow)), 0);
    }

    function testDepositWithPermitBadSignatureReverts() public {
        MockPermitUSDC permitUsdc = new MockPermitUSDC();
        BudgetEscrow permitEscrow = new BudgetEscrow(address(permitUsdc), owner, issuer);

        uint256 userKey = 0xBEEFCAFE;
        address user = vm.addr(userKey);
        permitUsdc.mint(user, 1_000_000_000);

        uint256 amount = 100_000_000;
        uint256 deadline = block.timestamp + 1 hours;
        // Sign with a different key => permit recover mismatch => contract
        // reverts because there is no pre-existing allowance to fall back to.
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(
            permitUsdc,
            0xDEADBEEF,
            user,
            address(permitEscrow),
            amount,
            permitUsdc.nonces(user),
            deadline
        );

        vm.prank(user);
        vm.expectRevert();
        permitEscrow.depositWithPermit(amount, deadline, v, r, s);
    }

    function testDepositWithPermitFallsBackToExistingAllowance() public {
        // Non-permit token: depositWithPermit should not revert if the user
        // has already approved the escrow for >= amount. This keeps the path
        // resilient when connecting to tokens that ignore EIP-2612.
        vm.startPrank(alice);
        usdc.approve(address(escrow), 50_000_000);
        escrow.depositWithPermit(50_000_000, block.timestamp + 1 hours, 0, bytes32(0), bytes32(0));
        vm.stopPrank();

        assertEq(escrow.deposits(alice), 50_000_000);
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

    function _signPermit(
        MockPermitUSDC permitUsdc,
        uint256 ownerKey,
        address ownerAddr,
        address spender,
        uint256 value,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (uint8, bytes32, bytes32) {
        bytes32 PERMIT_TYPEHASH =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, ownerAddr, spender, value, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", permitUsdc.DOMAIN_SEPARATOR(), structHash)
        );
        return vm.sign(ownerKey, digest);
    }
}
