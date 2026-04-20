package handler

import (
	"encoding/json"
	"net/http"
	"time"
)

type OpsLoginResponse struct {
	Token string `json:"token"`
	User  struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
		Role  string `json:"role"`
	} `json:"user"`
}

func (h *Handler) OpsLogin(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid request")
		return
	}
	if req.Email == "" || req.Password == "" {
		writeError(w, 400, "Email and password required")
		return
	}

	u, err := h.Queries.GetOpsUserByEmail(r.Context(), req.Email)
	if err != nil {
		writeError(w, 401, "Invalid email or password")
		return
	}
	if !checkPassword(req.Password, &u.PasswordHash) {
		writeError(w, 401, "Invalid email or password")
		return
	}

	claims := TokenClaims{
		OpsID: u.ID,
		Email: u.ContactEmail,
		Name:  u.Name,
		Role:  "ops",
		Exp:   time.Now().Add(12 * time.Hour).Unix(),
	}
	token, err := signToken(claims)
	if err != nil {
		writeError(w, 500, "Failed to generate token")
		return
	}

	resp := OpsLoginResponse{Token: token}
	resp.User.ID = u.ID
	resp.User.Name = u.Name
	resp.User.Email = u.ContactEmail
	resp.User.Role = u.Role
	writeJSON(w, 200, resp)
}

func (h *Handler) GetOpsMe(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsOps() {
		writeError(w, 401, "Not authenticated as ops")
		return
	}
	u, err := h.Queries.GetOpsUserByID(r.Context(), claims.OpsID)
	if err != nil {
		writeError(w, 500, "Failed to load ops profile")
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"id":    u.ID,
		"name":  u.Name,
		"email": u.ContactEmail,
		"role":  u.Role,
	})
}

// RequireOpsMiddleware rejects requests whose JWT is not an ops token.
func RequireOpsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r.Context())
		if claims == nil || !claims.IsOps() {
			writeError(w, 403, "Ops reviewer role required")
			return
		}
		next.ServeHTTP(w, r)
	})
}
