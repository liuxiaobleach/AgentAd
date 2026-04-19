// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AdAttestationRegistry.sol";

/// @notice Deploy AdAttestationRegistry.
/// Env required:
///   DEPLOYER_PRIVATE_KEY   - hex private key
///   ATTESTATION_ISSUER     - (optional) address authorized to issue; defaults to deployer
///   REGISTRY_OWNER         - (optional) new owner; defaults to deployer
contract DeployAdAttestationRegistry is Script {
    function run() external returns (address) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address extraIssuer = vm.envOr("ATTESTATION_ISSUER", address(0));
        address newOwner = vm.envOr("REGISTRY_OWNER", deployer);

        console.log("Deployer     :", deployer);
        console.log("ExtraIssuer  :", extraIssuer);
        console.log("Owner        :", newOwner);

        vm.startBroadcast(pk);
        AdAttestationRegistry reg = new AdAttestationRegistry();
        if (extraIssuer != address(0) && extraIssuer != deployer) {
            reg.addIssuer(extraIssuer);
        }
        if (newOwner != deployer) {
            reg.transferOwnership(newOwner);
        }
        vm.stopBroadcast();

        console.log("AdAttestationRegistry:", address(reg));
        return address(reg);
    }
}
