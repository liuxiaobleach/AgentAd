package tools

import (
	"bytes"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"regexp"
	"strings"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"
)

// urlPattern matches http and https URLs within decoded payloads.
var urlPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)
var domainLikePattern = regexp.MustCompile(`(?i)^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/[^\s"'<>]*)?$`)

// QRDecodeResult holds the result of decoding QR codes from an image.
type QRDecodeResult struct {
	Found    bool     `json:"found"`
	Payloads []string `json:"payloads"`
	URLs     []string `json:"urls"`
}

// DecodeQR attempts to decode QR codes from the given image bytes.
// If decoding fails for any reason, it returns a result with Found=false
// and empty slices rather than an error.
func DecodeQR(imageData []byte) *QRDecodeResult {
	result := &QRDecodeResult{
		Found:    false,
		Payloads: make([]string, 0),
		URLs:     make([]string, 0),
	}

	// Decode the image bytes into an image.Image.
	img, _, err := image.Decode(bytes.NewReader(imageData))
	if err != nil {
		return result
	}

	// Convert to a gozxing-compatible bitmap.
	bmp, err := gozxing.NewBinaryBitmapFromImage(img)
	if err != nil {
		return result
	}

	// Attempt QR code decoding.
	reader := qrcode.NewQRCodeReader()
	decoded, err := reader.Decode(bmp, nil)
	if err != nil {
		return result
	}

	payload := decoded.GetText()
	if payload == "" {
		return result
	}

	result.Found = true
	result.Payloads = append(result.Payloads, payload)

	// Extract any URLs found in the payload.
	urls := urlPattern.FindAllString(payload, -1)
	if len(urls) == 0 {
		trimmed := strings.TrimSpace(payload)
		if domainLikePattern.MatchString(trimmed) {
			urls = append(urls, "https://"+trimmed)
		}
	}
	result.URLs = append(result.URLs, urls...)

	return result
}
