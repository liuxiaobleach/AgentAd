package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	DatabaseURL      string
	AnthropicAPIKey  string
	AuditModel       string
	OpenAIAPIKey     string
	ImageModel       string
	GeminiAPIKey     string
	GeminiImageModel string
	UploadDir        string
	Port             string
	RegistryAddress  string
	IssuerAddress    string
	AllowedOrigins   string

	X402Enabled               bool
	X402Network               string
	X402EVMPrivateKey         string
	X402RPCURL                string
	GenerateBaseFeeAtomic     int64
	GenerateExternalCapAtomic int64
	AuditBaseFeeAtomic        int64
	AuditExternalCapAtomic    int64

	SepoliaChainID         int64
	SepoliaRPCURL          string
	SepoliaUSDCAddress     string
	SepoliaTreasuryAddress string
	SepoliaExplorerBaseURL string
}

func Load() *Config {
	return &Config{
		DatabaseURL:               getEnv("DATABASE_URL", ""),
		AnthropicAPIKey:           getEnv("ANTHROPIC_API_KEY", ""),
		AuditModel:                getEnv("AUDIT_MODEL", "claude-sonnet-4-20250514"),
		OpenAIAPIKey:              getEnv("OPENAI_API_KEY", ""),
		ImageModel:                getEnv("IMAGE_MODEL", "dall-e-3"),
		GeminiAPIKey:              getEnv("GEMINI_API_KEY", ""),
		GeminiImageModel:          getEnv("GEMINI_IMAGE_MODEL", "imagen-4.0-fast-generate-001"),
		UploadDir:                 getEnv("UPLOAD_DIR", "./uploads"),
		Port:                      getEnv("PORT", "8080"),
		RegistryAddress:           getEnv("REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000"),
		IssuerAddress:             getEnv("ISSUER_ADDRESS", "0x0000000000000000000000000000000000000000"),
		AllowedOrigins:            getEnv("ALLOWED_ORIGINS", "http://localhost:3000"),
		X402Enabled:               getEnvBool("X402_ENABLED", false),
		X402Network:               getEnv("X402_NETWORK", "eip155:*"),
		X402EVMPrivateKey:         getEnv("X402_EVM_PRIVATE_KEY", ""),
		X402RPCURL:                getEnv("X402_RPC_URL", ""),
		GenerateBaseFeeAtomic:     getEnvInt64("GENERATE_BASE_FEE_ATOMIC", 200000),
		GenerateExternalCapAtomic: getEnvInt64("GENERATE_EXTERNAL_CAP_ATOMIC", 300000),
		AuditBaseFeeAtomic:        getEnvInt64("AUDIT_BASE_FEE_ATOMIC", 100000),
		AuditExternalCapAtomic:    getEnvInt64("AUDIT_EXTERNAL_CAP_ATOMIC", 150000),
		SepoliaChainID:            getEnvInt64("SEPOLIA_CHAIN_ID", 11155111),
		SepoliaRPCURL:             getEnv("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
		SepoliaUSDCAddress:        getEnv("SEPOLIA_USDC_ADDRESS", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"),
		SepoliaTreasuryAddress:    getEnv("SEPOLIA_TREASURY_ADDRESS", ""),
		SepoliaExplorerBaseURL:    getEnv("SEPOLIA_EXPLORER_BASE_URL", "https://sepolia.etherscan.io/tx/"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt64(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			return parsed
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return fallback
}
