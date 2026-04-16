package handler

import (
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/zkdsp/audit-backend/internal/db"
)

func (h *Handler) ListCreatives(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	var creatives []db.Creative
	var err error
	if claims != nil {
		creatives, err = h.Queries.ListCreativesByAdvertiser(r.Context(), claims.AdvertiserID)
	} else {
		creatives, err = h.Queries.ListCreatives(r.Context())
	}
	if err != nil {
		writeError(w, 500, "Failed to list creatives: "+err.Error())
		return
	}
	if creatives == nil {
		creatives = []db.Creative{}
	}
	writeJSON(w, 200, creatives)
}

func (h *Handler) GetCreative(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	creative, err := h.Queries.GetCreative(r.Context(), id)
	if err != nil {
		writeError(w, 404, "Not found")
		return
	}
	writeJSON(w, 200, creative)
}

func (h *Handler) CreateCreative(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, 400, "Failed to parse form: "+err.Error())
		return
	}

	creativeName := r.FormValue("creativeName")
	projectName := r.FormValue("projectName")
	landingURL := r.FormValue("landingUrl")

	if creativeName == "" || projectName == "" || landingURL == "" {
		writeError(w, 400, "creativeName, projectName, and landingUrl are required")
		return
	}

	// Parse optional fields
	var clickURL, telegramURL, contractAddress, notes *string
	var chainID *int
	var placementDomains []string

	if v := r.FormValue("clickUrl"); v != "" {
		clickURL = &v
	}
	if v := r.FormValue("telegramUrl"); v != "" {
		telegramURL = &v
	}
	if v := r.FormValue("contractAddress"); v != "" {
		contractAddress = &v
	}
	if v := r.FormValue("notes"); v != "" {
		notes = &v
	}
	if v := r.FormValue("chainId"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			chainID = &n
		}
	}
	if v := r.FormValue("placementDomains"); v != "" {
		for _, d := range strings.Split(v, ",") {
			if trimmed := strings.TrimSpace(d); trimmed != "" {
				placementDomains = append(placementDomains, trimmed)
			}
		}
	}

	// Handle image upload
	var imageURL, creativeHash *string
	file, header, err := r.FormFile("imageFile")
	if err == nil {
		defer file.Close()

		data, err := io.ReadAll(file)
		if err != nil {
			writeError(w, 500, "Failed to read image: "+err.Error())
			return
		}

		// Compute SHA-256
		hash := sha256.Sum256(data)
		hashStr := fmt.Sprintf("0x%x", hash)
		creativeHash = &hashStr

		// Save file
		uploadDir := h.Config.UploadDir
		os.MkdirAll(uploadDir, 0755)
		fileName := fmt.Sprintf("%d-%s", time.Now().UnixMilli(), header.Filename)
		filePath := filepath.Join(uploadDir, fileName)
		if err := os.WriteFile(filePath, data, 0644); err != nil {
			writeError(w, 500, "Failed to save image: "+err.Error())
			return
		}
		urlStr := "/uploads/" + fileName
		imageURL = &urlStr
	}

	// Use authenticated advertiser
	claims := GetClaims(r.Context())
	advertiserID := ""
	if claims != nil {
		advertiserID = claims.AdvertiserID
	} else {
		adv, err := h.Queries.GetOrCreateDefaultAdvertiser(r.Context())
		if err != nil {
			writeError(w, 500, "Failed to get advertiser: "+err.Error())
			return
		}
		advertiserID = adv.ID
	}

	creative := db.Creative{
		AdvertiserID:     advertiserID,
		CreativeName:     creativeName,
		ProjectName:      projectName,
		ImageURL:         imageURL,
		CreativeHash:     creativeHash,
		LandingURL:       landingURL,
		TelegramURL:      telegramURL,
		ClickURL:         clickURL,
		ChainID:          chainID,
		ContractAddress:  contractAddress,
		PlacementDomains: placementDomains,
		Notes:            notes,
		Status:           db.CreativeStatusDraft,
	}

	created, err := h.Queries.CreateCreative(r.Context(), creative)
	if err != nil {
		writeError(w, 500, "Failed to create creative: "+err.Error())
		return
	}

	writeJSON(w, 201, created)
}

func (h *Handler) DeleteCreative(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	if err := h.Queries.DeleteCreative(r.Context(), id, claims.AdvertiserID); err != nil {
		writeError(w, 400, err.Error())
		return
	}

	writeJSON(w, 200, map[string]string{"message": "Deleted"})
}
