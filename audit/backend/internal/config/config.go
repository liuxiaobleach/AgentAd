package config

import "os"

type Config struct {
	DatabaseURL     string
	AnthropicAPIKey string
	AuditModel      string
	OpenAIAPIKey    string
	ImageModel      string
	GeminiAPIKey    string
	GeminiImageModel string
	UploadDir       string
	Port            string
	RegistryAddress string
	IssuerAddress   string
	AllowedOrigins  string
}

func Load() *Config {
	return &Config{
		DatabaseURL:     getEnv("DATABASE_URL", ""),
		AnthropicAPIKey: getEnv("ANTHROPIC_API_KEY", ""),
		AuditModel:      getEnv("AUDIT_MODEL", "claude-sonnet-4-20250514"),
		OpenAIAPIKey:    getEnv("OPENAI_API_KEY", ""),
		ImageModel:      getEnv("IMAGE_MODEL", "dall-e-3"),
		GeminiAPIKey:    getEnv("GEMINI_API_KEY", ""),
		GeminiImageModel: getEnv("GEMINI_IMAGE_MODEL", "imagen-3.0-generate-002"),
		UploadDir:       getEnv("UPLOAD_DIR", "./uploads"),
		Port:            getEnv("PORT", "8080"),
		RegistryAddress: getEnv("REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000"),
		IssuerAddress:   getEnv("ISSUER_ADDRESS", "0x0000000000000000000000000000000000000000"),
		AllowedOrigins:  getEnv("ALLOWED_ORIGINS", "http://localhost:3000"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
