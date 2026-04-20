// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IProofVerifier
/// @notice Minimal interface the on-chain settlement code uses to check zkVM
///         proofs. Pico emits an auto-generated Groth16 verifier contract per
///         compiled guest; we wrap it behind this interface so the proof system
///         can be swapped (e.g. to PLONK / Halo2) with only a config change.
///
/// The verifier is expected to:
///   1. Decode `proof` as the native proof encoding for whatever system Pico
///      targets (Groth16 by default: three G1 + one G2 points, ~192 bytes).
///   2. Treat `publicInputs` as the exact byte sequence the guest committed.
///      The wrapper re-hashes and maps it to the field element(s) the
///      underlying verifier expects.
///   3. Return true iff the proof is valid and commits to those inputs.
interface IProofVerifier {
    function verify(
        bytes calldata publicInputs,
        bytes calldata proof
    ) external view returns (bool);
}
