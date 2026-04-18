package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Simple JWT-like token (HMAC-SHA256, no external deps).
// The secret is injected from backend config during handler initialization.
var jwtSecret []byte

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token      string `json:"token"`
	Advertiser struct {
		ID            string  `json:"id"`
		Name          string  `json:"name"`
		Email         string  `json:"email"`
		WalletAddress *string `json:"walletAddress"`
	} `json:"advertiser"`
}

type TokenClaims struct {
	AdvertiserID string `json:"sub"`           // advertiser id, "" for publisher tokens
	PublisherID  string `json:"pub,omitempty"` // publisher id, "" for advertiser tokens
	Email        string `json:"email"`
	Name         string `json:"name"`
	Role         string `json:"role,omitempty"` // "advertiser" (default/empty) | "publisher"
	Exp          int64  `json:"exp"`
}

// IsPublisher is true when the token was issued to a publisher account.
func (c *TokenClaims) IsPublisher() bool { return c.Role == "publisher" }

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid request")
		return
	}

	if req.Email == "" || req.Password == "" {
		writeError(w, 400, "Email and password required")
		return
	}

	// Look up advertiser by email
	adv, err := h.Queries.GetAdvertiserByEmail(r.Context(), req.Email)
	if err != nil {
		writeError(w, 401, "Invalid email or password")
		return
	}

	// Compare the submitted password against the stored bcrypt hash.
	if !checkPassword(req.Password, adv.PasswordHash) {
		writeError(w, 401, "Invalid email or password")
		return
	}

	// Generate token
	claims := TokenClaims{
		AdvertiserID: adv.ID,
		Email:        adv.ContactEmail,
		Name:         adv.Name,
		Role:         "advertiser",
		Exp:          time.Now().Add(24 * time.Hour).Unix(),
	}
	token, err := signToken(claims)
	if err != nil {
		writeError(w, 500, "Failed to generate token")
		return
	}

	resp := LoginResponse{Token: token}
	resp.Advertiser.ID = adv.ID
	resp.Advertiser.Name = adv.Name
	resp.Advertiser.Email = adv.ContactEmail
	resp.Advertiser.WalletAddress = normalizedOptionalWalletAddress(adv.WalletAddress)
	writeJSON(w, 200, resp)
}

func (h *Handler) GetMe(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	advertiser, err := h.Queries.GetAdvertiserByID(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, "Failed to load advertiser profile")
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"id":            advertiser.ID,
		"name":          advertiser.Name,
		"email":         advertiser.ContactEmail,
		"walletAddress": normalizedOptionalWalletAddress(advertiser.WalletAddress),
	})
}

// AuthMiddleware validates JWT and injects claims into context
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			writeError(w, 401, "Authorization header required")
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := verifyToken(token)
		if err != nil {
			writeError(w, 401, "Invalid token")
			return
		}

		if claims.Exp < time.Now().Unix() {
			writeError(w, 401, "Token expired")
			return
		}

		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type contextKey string

const claimsKey contextKey = "claims"

func GetClaims(ctx context.Context) *TokenClaims {
	claims, _ := ctx.Value(claimsKey).(*TokenClaims)
	return claims
}

func SetJWTSecret(secret string) {
	jwtSecret = []byte(strings.TrimSpace(secret))
}

func requireJWTSecret() error {
	if len(jwtSecret) == 0 {
		return errors.New("JWT secret is not configured")
	}
	return nil
}

// Passwords are stored as bcrypt hashes in seeded migrations and DB records.
func checkPassword(password string, hash *string) bool {
	if hash == nil || strings.TrimSpace(*hash) == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(*hash), []byte(password)) == nil
}

func signToken(claims TokenClaims) (string, error) {
	if err := requireJWTSecret(); err != nil {
		return "", err
	}

	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body := base64.RawURLEncoding.EncodeToString(payload)
	sigInput := header + "." + body

	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(sigInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return sigInput + "." + sig, nil
}

func verifyToken(token string) (*TokenClaims, error) {
	if err := requireJWTSecret(); err != nil {
		return nil, err
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, http.ErrNotSupported
	}

	sigInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(sigInput))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, http.ErrNotSupported
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}

	var claims TokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, err
	}

	return &claims, nil
}

func normalizedOptionalWalletAddress(raw *string) *string {
	if raw == nil {
		return nil
	}
	normalized, err := normalizeHexAddress(*raw)
	if err != nil {
		return nil
	}
	return &normalized
}
