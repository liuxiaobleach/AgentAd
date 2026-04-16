package attestation

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"
)

// AttestationInput contains the parameters needed to issue an attestation.
type AttestationInput struct {
	AuditCaseID      string
	CreativeHash     string
	DestinationURL   string
	PolicyVersion    string
	PlacementDomains []string
	ExpiresInDays    int
}

// AttestationOutput is the result of issuing an attestation.
type AttestationOutput struct {
	AttestationID       string
	CreativeHash        string
	DestinationHash     string
	PlacementDomainHash string
	PolicyVersionHash   string
	IssuedAt            int64
	ExpiresAt           int64
}

// CreativeInfo holds creative metadata used when generating a manifest.
type CreativeInfo struct {
	ProjectName string
	ImageURL    string
	ClickURL    string
	LandingURL  string
}

// ManifestData represents the full manifest JSON structure.
type ManifestData struct {
	ManifestID         string `json:"manifestId"`
	CreativeID         string `json:"creativeId"`
	ProjectName        string `json:"projectName"`
	CreativeURL        string `json:"creativeUrl"`
	ClickURL           string `json:"clickUrl"`
	DeclaredLandingURL string `json:"declaredLandingUrl"`
	ChainID            int    `json:"chainId"`
	RegistryAddress    string `json:"registryAddress"`
	AttestationID      string `json:"attestationId"`
	CreativeHash       string `json:"creativeHash"`
	DestinationHash    string `json:"destinationHash"`
	PolicyVersion      string `json:"policyVersion"`
	IssuedAt           int64  `json:"issuedAt"`
	ExpiresAt          int64  `json:"expiresAt"`
	Issuer             string `json:"issuer"`
	ReportURL          string `json:"reportUrl"`
}

// sha256Hex computes the SHA-256 hash of data and returns it as a 0x-prefixed hex string.
func sha256Hex(data string) string {
	h := sha256.Sum256([]byte(data))
	return "0x" + hex.EncodeToString(h[:])
}

// randomHex generates n random bytes and returns them as a hex string.
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate random bytes: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// IssueAttestation creates a new attestation from the given input.
func IssueAttestation(input AttestationInput) (AttestationOutput, error) {
	// Generate random 32-byte attestation ID
	randID, err := randomHex(32)
	if err != nil {
		return AttestationOutput{}, err
	}
	attestationID := "0x" + randID

	now := time.Now().Unix()

	expiresInDays := input.ExpiresInDays
	if expiresInDays <= 0 {
		expiresInDays = 30
	}
	expiresAt := now + int64(expiresInDays)*24*60*60

	// Compute hashes
	destinationHash := sha256Hex(input.DestinationURL)

	// Sort placement domains and join with comma, matching the TS implementation
	domains := make([]string, len(input.PlacementDomains))
	copy(domains, input.PlacementDomains)
	sort.Strings(domains)
	placementDomainHash := sha256Hex(strings.Join(domains, ","))

	policyVersionHash := sha256Hex(input.PolicyVersion)

	return AttestationOutput{
		AttestationID:       attestationID,
		CreativeHash:        input.CreativeHash,
		DestinationHash:     destinationHash,
		PlacementDomainHash: placementDomainHash,
		PolicyVersionHash:   policyVersionHash,
		IssuedAt:            now,
		ExpiresAt:           expiresAt,
	}, nil
}

// GenerateManifest creates a ManifestData struct from an attestation and creative info.
func GenerateManifest(creativeID string, att AttestationOutput, creative CreativeInfo, registryAddress string, issuerAddress string) (ManifestData, error) {
	randID, err := randomHex(8)
	if err != nil {
		return ManifestData{}, err
	}
	manifestID := "mf_" + randID

	clickURL := creative.ClickURL
	if clickURL == "" {
		clickURL = creative.LandingURL
	}

	if registryAddress == "" {
		registryAddress = "0x0000000000000000000000000000000000000000"
	}
	if issuerAddress == "" {
		issuerAddress = "0x0000000000000000000000000000000000000000"
	}

	return ManifestData{
		ManifestID:         manifestID,
		CreativeID:         creativeID,
		ProjectName:        creative.ProjectName,
		CreativeURL:        creative.ImageURL,
		ClickURL:           clickURL,
		DeclaredLandingURL: creative.LandingURL,
		ChainID:            84532, // Base Sepolia
		RegistryAddress:    registryAddress,
		AttestationID:      att.AttestationID,
		CreativeHash:       att.CreativeHash,
		DestinationHash:    att.DestinationHash,
		PolicyVersion:      "v1.0",
		IssuedAt:           att.IssuedAt,
		ExpiresAt:          att.ExpiresAt,
		Issuer:             issuerAddress,
		ReportURL:          fmt.Sprintf("/api/reports/%s", att.AttestationID),
	}, nil
}
