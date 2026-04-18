// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/BudgetEscrow.sol";

/// @notice Deploy BudgetEscrow.
/// Env required:
///   DEPLOYER_PRIVATE_KEY  - hex private key (no 0x prefix ok either way)
///   USDC_ADDRESS          - ERC20 token address (Sepolia USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)
///   ESCROW_OWNER          - address that will own refund/sweep (defaults to deployer)
contract DeployBudgetEscrow is Script {
    function run() external returns (address) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("ESCROW_OWNER", deployer);
        address issuer = vm.envAddress("ISSUER_ADDRESS");

        console.log("Deployer :", deployer);
        console.log("Token    :", usdc);
        console.log("Owner    :", owner);
        console.log("Issuer   :", issuer);

        vm.startBroadcast(pk);
        BudgetEscrow escrow = new BudgetEscrow(usdc, owner, issuer);
        vm.stopBroadcast();

        console.log("BudgetEscrow deployed at:", address(escrow));
        return address(escrow);
    }
}
