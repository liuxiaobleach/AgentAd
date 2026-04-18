package handler

import (
	"encoding/json"
	"net/http"
	"time"
)

type PublisherLoginResponse struct {
	Token     string `json:"token"`
	Publisher struct {
		ID            string  `json:"id"`
		Name          string  `json:"name"`
		Email         string  `json:"email"`
		WalletAddress *string `json:"walletAddress"`
		Role          string  `json:"role"`
	} `json:"publisher"`
}

func (h *Handler) PublisherLogin(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid request")
		return
	}
	if req.Email == "" || req.Password == "" {
		writeError(w, 400, "Email and password required")
		return
	}

	pub, err := h.Queries.GetPublisherByEmail(r.Context(), req.Email)
	if err != nil {
		writeError(w, 401, "Invalid email or password")
		return
	}
	if !checkPassword(req.Password, &pub.PasswordHash) {
		writeError(w, 401, "Invalid email or password")
		return
	}

	claims := TokenClaims{
		PublisherID: pub.ID,
		Email:       pub.ContactEmail,
		Name:        pub.Name,
		Role:        "publisher",
		Exp:         time.Now().Add(24 * time.Hour).Unix(),
	}
	token, err := signToken(claims)
	if err != nil {
		writeError(w, 500, "Failed to generate token")
		return
	}

	resp := PublisherLoginResponse{Token: token}
	resp.Publisher.ID = pub.ID
	resp.Publisher.Name = pub.Name
	resp.Publisher.Email = pub.ContactEmail
	resp.Publisher.WalletAddress = normalizedOptionalWalletAddress(pub.WalletAddress)
	resp.Publisher.Role = "publisher"
	writeJSON(w, 200, resp)
}

func (h *Handler) GetPublisherMe(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}
	pub, err := h.Queries.GetPublisherByID(r.Context(), claims.PublisherID)
	if err != nil {
		writeError(w, 500, "Failed to load publisher profile")
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"id":            pub.ID,
		"name":          pub.Name,
		"email":         pub.ContactEmail,
		"walletAddress": normalizedOptionalWalletAddress(pub.WalletAddress),
		"role":          "publisher",
	})
}

// RequirePublisherMiddleware rejects requests whose JWT is not a publisher token.
func RequirePublisherMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r.Context())
		if claims == nil || !claims.IsPublisher() {
			writeError(w, 403, "Publisher role required")
			return
		}
		next.ServeHTTP(w, r)
	})
}
