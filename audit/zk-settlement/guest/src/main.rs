//! Pico zkVM guest program for AgentAd batch settlement.
//!
//! Inside the zkVM we:
//!   1. Read the `Witness` from stdin (Pico's bincode channel).
//!   2. Verify every event belongs to the claiming publisher + epoch and
//!      Merkle-includes into the committed log root.
//!   3. Sum per-event credits from the rate card.
//!   4. Assert the derived total equals the claimed amount.
//!   5. Commit the public inputs to the proof.
//!
//! The verifier on-chain re-computes the public-input digest and checks the
//! claimed `log_root` matches the one EpochRegistry recorded for the epoch.

#![no_main]
pico_sdk::entrypoint!(main);

use pico_sdk::io::{commit, read_as};
use settlement_lib::{compute_settlement, PublicInputs, Witness};

pub fn main() {
    let w: Witness = read_as();

    let derived = compute_settlement(&w);
    let claimed: u128 = w
        .public
        .amount_claim
        .parse::<u128>()
        .expect("amount_claim must be a u128 decimal");
    assert_eq!(derived, claimed, "claimed amount does not match derived amount");

    // Commit a clone of PublicInputs — the prover will bincode-deserialize it
    // from proof.pv_stream and the on-chain verifier will re-hash the same
    // canonical encoding.
    let committed = PublicInputs {
        epoch_id: w.public.epoch_id,
        publisher: w.public.publisher,
        amount_claim: w.public.amount_claim.clone(),
        log_root: w.public.log_root,
        currency: w.public.currency,
    };
    commit(&committed);
}
