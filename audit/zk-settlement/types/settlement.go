// Package types holds the wire/on-disk schema shared between the host CLIs,
// the zkVM guest, and the on-chain verifier. Changes here force a rebuild of
// the guest AND a migration of any persisted epoch files, so treat this file
// as a protocol boundary.
package types

// Bytes32 is a 32-byte array that (un)marshals as a (0x-prefixed) hex string.
type Bytes32 [32]byte

func (b Bytes32) MarshalJSON() ([]byte, error)   { return hexMarshal(b[:]) }
func (b *Bytes32) UnmarshalJSON(d []byte) error  { return hexUnmarshal(d, b[:], "Bytes32") }

// Address is a 20-byte EVM address, hex-encoded in JSON.
type Address [20]byte

func (a Address) MarshalJSON() ([]byte, error)   { return hexMarshal(a[:]) }
func (a *Address) UnmarshalJSON(d []byte) error  { return hexUnmarshal(d, a[:], "Address") }

// Bytes16 is a 16-byte tag (e.g. per-render nonce).
type Bytes16 [16]byte

func (b Bytes16) MarshalJSON() ([]byte, error)   { return hexMarshal(b[:]) }
func (b *Bytes16) UnmarshalJSON(d []byte) error  { return hexUnmarshal(d, b[:], "Bytes16") }

// ImpressionEvent is one credited ad view. It is the leaf of the per-epoch
// Merkle tree. Every field is fixed-width so the canonical byte encoding (see
// host/impression.go) matches the guest's hash input exactly.
type ImpressionEvent struct {
	// 32-byte campaign identifier. In the live system this is the keccak256 of
	// the manifest URL committed on-chain — collision-resistant and stable.
	CampaignID Bytes32 `json:"campaign_id"`

	// 20-byte publisher wallet that earns on this impression.
	Publisher Address `json:"publisher"`

	// Monotonic settlement epoch (e.g. unix_day or sequence number).
	EpochID uint64 `json:"epoch_id"`

	// 32-byte on-chain attestation id that authorized this render. Any
	// impression whose attestation is EXPIRED or REVOKED at epoch close MUST
	// be excluded upstream — the guest does not re-check attestation state.
	AttestationID Bytes32 `json:"attestation_id"`

	// Observed view duration in milliseconds. Kept for future quality scoring;
	// not currently used in settlement but committed so the log is tamper-evident.
	ViewedMs uint64 `json:"viewed_ms"`

	// 16-byte per-render nonce. De-duplication key within a single manifest.
	Nonce Bytes16 `json:"nonce"`
}

// RateCardEntry captures the agreed CPM for a campaign at epoch open.
// Snapshotting at epoch boundary prevents mid-epoch rate changes from
// retroactively affecting impressions that were already served.
type RateCardEntry struct {
	CampaignID Bytes32 `json:"campaign_id"`
	// Pre-scaled for integer math: stored as (USDC-atomic-units per impression * 1_000).
	// The guest divides by 1_000 to get per-event atomic USDC without losing precision.
	// Example: $2.00 CPM = $0.002/impression = 2000 atomic USDC/imp → encoded as 2_000_000.
	CpmMicroUSDC string `json:"cpm_micro_usdc"` // decimal string — witness carries u128
}

// PublicInputs is the tuple the zkVM proof commits to and the chain re-hashes.
// Order MUST match guest/src/main.rs::commit_public_inputs() and the
// abi.encodePacked sequence in ZkClaimEscrow._hashPublicInputs().
type PublicInputs struct {
	EpochID     uint64  `json:"epoch_id"`
	Publisher   Address `json:"publisher"`
	AmountClaim string  `json:"amount_claim"` // decimal string — u128 on-chain
	LogRoot     Bytes32 `json:"log_root"`
	Currency    Address `json:"currency"` // USDC token address
}

// ProvenEvent is an impression packaged with its Merkle inclusion proof against
// the epoch's log root. Consumed by the guest, so the field names are locked.
type ProvenEvent struct {
	Event    ImpressionEvent `json:"event"`
	Path     []Bytes32       `json:"path"`      // sibling hashes, leaf → root
	PathDirs uint64          `json:"path_dirs"` // bit i: 1 = sibling is RIGHT of current node
}

// Witness is the full input bundle passed to the guest on stdin.
type Witness struct {
	Public   PublicInputs    `json:"public"`
	Events   []ProvenEvent   `json:"events"`
	RateCard []RateCardEntry `json:"rate_card"`
}

// EpochArchive is what build-epoch writes to disk. prove-claim reads it to
// rebuild per-publisher witnesses without re-ingesting the raw DB.
type EpochArchive struct {
	EpochID     uint64            `json:"epoch_id"`
	Currency    Address           `json:"currency"`
	LogRoot     Bytes32           `json:"log_root"`
	Leaves      []ImpressionEvent `json:"leaves"` // sorted, deduped
	RateCard    []RateCardEntry   `json:"rate_card"`
	CommittedAt int64             `json:"committed_at"` // unix seconds; set when onchain tx lands
}
