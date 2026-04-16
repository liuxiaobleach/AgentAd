package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (h *Handler) ServeUpload(w http.ResponseWriter, r *http.Request) {
	// Extract path after /uploads/
	urlPath := r.URL.Path
	filePart := strings.TrimPrefix(urlPath, "/uploads/")
	if filePart == "" || strings.Contains(filePart, "..") {
		http.NotFound(w, r)
		return
	}

	filePath := filepath.Join(h.Config.UploadDir, filePart)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	// Set content type based on extension
	ext := strings.ToLower(filepath.Ext(filePath))
	mimeTypes := map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
	}
	if ct, ok := mimeTypes[ext]; ok {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")

	http.ServeFile(w, r, filePath)
}
