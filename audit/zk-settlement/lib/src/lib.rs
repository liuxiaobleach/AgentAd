//! Shared Rust types for the AgentAd settlement guest + prover.
//!
//! Same schema as zk-settlement/types/settlement.go. The guest deserializes
//! via bincode (Pico's stdin); the prover deserializes the host-produced JSON
//! via serde_json, then re-serializes to the guest via `stdin_builder.write`.
//! Keep the field order and leaf encoding in lock-step with the Go host —
//! see host/impression.go and host/publicinputs.go.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Witness types (bincode + serde_json compatible)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct ImpressionEvent {
    #[serde(with = "hex32")]
    pub campaign_id: [u8; 32],
    #[serde(with = "hex20")]
    pub publisher: [u8; 20],
    pub epoch_id: u64,
    #[serde(with = "hex32")]
    pub attestation_id: [u8; 32],
    pub viewed_ms: u64,
    #[serde(with = "hex16")]
    pub nonce: [u8; 16],
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RateCardEntry {
    #[serde(with = "hex32")]
    pub campaign_id: [u8; 32],
    // Pre-scaled: atomic USDC per impression × 1000. Stored as decimal string
    // so u128 round-trips through JSON without losing precision.
    pub cpm_micro_usdc: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PublicInputs {
    pub epoch_id: u64,
    #[serde(with = "hex20")]
    pub publisher: [u8; 20],
    // u128 as decimal string.
    pub amount_claim: String,
    #[serde(with = "hex32")]
    pub log_root: [u8; 32],
    #[serde(with = "hex20")]
    pub currency: [u8; 20],
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProvenEvent {
    pub event: ImpressionEvent,
    // Sibling hashes from leaf → root.
    pub path: Vec<ByteArray32>,
    // Bit i = 1 ⇔ sibling at depth i sits to the RIGHT of current node.
    pub path_dirs: u64,
}

// Named newtype so `Vec<ByteArray32>` serializes each element as one hex
// string, which is what the Go host emits (`[][32]byte` → array of hex strings).
#[derive(Clone, Copy)]
pub struct ByteArray32(pub [u8; 32]);

impl Serialize for ByteArray32 {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&hex::encode(self.0))
    }
}

impl<'de> Deserialize<'de> for ByteArray32 {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);
        let bytes = hex::decode(s).map_err(serde::de::Error::custom)?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| serde::de::Error::custom("ByteArray32: wrong length"))?;
        Ok(ByteArray32(arr))
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Witness {
    pub public: PublicInputs,
    pub events: Vec<ProvenEvent>,
    pub rate_card: Vec<RateCardEntry>,
}

// ---------------------------------------------------------------------------
// Hex serde helpers for fixed-width byte arrays
// ---------------------------------------------------------------------------

macro_rules! hex_mod {
    ($name:ident, $n:expr) => {
        pub mod $name {
            use serde::{Deserialize, Deserializer, Serializer};

            pub fn serialize<S: Serializer>(b: &[u8; $n], s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(&hex::encode(b))
            }

            pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; $n], D::Error> {
                let s = String::deserialize(d)?;
                let s = s.strip_prefix("0x").unwrap_or(&s);
                let bytes = hex::decode(s).map_err(serde::de::Error::custom)?;
                bytes.try_into().map_err(|v: Vec<u8>| {
                    serde::de::Error::custom(format!("expected {} bytes, got {}", $n, v.len()))
                })
            }
        }
    };
}

hex_mod!(hex32, 32);
hex_mod!(hex20, 20);
hex_mod!(hex16, 16);

// ---------------------------------------------------------------------------
// Canonical leaf / merkle hashing — MUST match host/impression.go + host/merkle.go
// ---------------------------------------------------------------------------

pub const LEAF_PREFIX: u8 = 0x00;
pub const NODE_PREFIX: u8 = 0x01;

pub fn leaf_hash(e: &ImpressionEvent) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([LEAF_PREFIX]);
    h.update(e.campaign_id);
    h.update(e.publisher);
    h.update(e.epoch_id.to_be_bytes());
    h.update(e.attestation_id);
    h.update(e.viewed_ms.to_be_bytes());
    h.update(e.nonce);
    h.finalize().into()
}

pub fn hash_pair(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([NODE_PREFIX]);
    h.update(a);
    h.update(b);
    h.finalize().into()
}

/// Re-derive the merkle root from a leaf + inclusion path. See host/merkle.go::VerifyProof.
///
/// `dirs` bit i == 1 means the sibling at depth i sits to the RIGHT of the
/// current node (we are the left child), so the hash order is (node, sibling).
pub fn merkle_root_from_path(leaf: [u8; 32], siblings: &[ByteArray32], dirs: u64) -> [u8; 32] {
    let mut node = leaf;
    for (i, sib) in siblings.iter().enumerate() {
        let sib_is_right = (dirs >> (i as u64)) & 1 == 1;
        let (l, r) = if sib_is_right {
            (node, sib.0) // we are left, sibling is right
        } else {
            (sib.0, node) // sibling is left, we are right
        };
        node = hash_pair(l, r);
    }
    node
}

// ---------------------------------------------------------------------------
// Settlement core — used by guest to compute + assert the claim amount
// ---------------------------------------------------------------------------

/// Finds the CPM for `campaign_id` in the rate card. Panics if missing — the
/// host validates before generating the witness, so a miss here is a bug.
pub fn cpm_for(rate_card: &[RateCardEntry], campaign_id: &[u8; 32]) -> u128 {
    for entry in rate_card {
        if &entry.campaign_id == campaign_id {
            return entry
                .cpm_micro_usdc
                .parse::<u128>()
                .expect("rate card cpm_micro_usdc must be a u128 decimal");
        }
    }
    panic!("campaign not present in rate card");
}

/// Deterministic settlement pass. For every event in the witness:
///   1. Verify it belongs to the claiming publisher & epoch.
///   2. Verify Merkle inclusion against the public log_root.
///   3. Add the per-event credit (cpm / 1000) to the running total.
///
/// Returns the derived total as a u128.
pub fn compute_settlement(w: &Witness) -> u128 {
    let expected_publisher = w.public.publisher;
    let expected_epoch = w.public.epoch_id;
    let expected_root = w.public.log_root;

    let mut total: u128 = 0;
    for proven in &w.events {
        let e = &proven.event;
        assert_eq!(e.publisher, expected_publisher, "event publisher mismatch");
        assert_eq!(e.epoch_id, expected_epoch, "event epoch mismatch");

        let leaf = leaf_hash(e);
        let got = merkle_root_from_path(leaf, &proven.path, proven.path_dirs);
        assert_eq!(got, expected_root, "merkle inclusion failed");

        let cpm = cpm_for(&w.rate_card, &e.campaign_id);
        total = total
            .checked_add(cpm / 1000)
            .expect("settlement overflow");
    }
    total
}
