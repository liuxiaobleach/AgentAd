package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/zkdsp/audit-backend/internal/db"
)

// resolveRequester maps the JWT claims into the (requester_type, requester_id,
// requester_name, requester_email) tuple used by the support tables.
func (h *Handler) resolveRequester(r *http.Request) (reqType, reqID, reqName, reqEmail string, ok bool) {
	claims := GetClaims(r.Context())
	if claims == nil {
		return "", "", "", "", false
	}
	if claims.IsPublisher() {
		if claims.PublisherID == "" {
			return "", "", "", "", false
		}
		pub, err := h.Queries.GetPublisherByID(r.Context(), claims.PublisherID)
		if err != nil {
			return "", "", "", "", false
		}
		return "publisher", pub.ID, pub.Name, pub.ContactEmail, true
	}
	if claims.AdvertiserID == "" {
		return "", "", "", "", false
	}
	adv, err := h.Queries.GetAdvertiserByID(r.Context(), claims.AdvertiserID)
	if err != nil {
		return "", "", "", "", false
	}
	return "advertiser", adv.ID, adv.Name, adv.ContactEmail, true
}

type createSupportTicketRequest struct {
	Category string `json:"category"`
	Subject  string `json:"subject"`
	Body     string `json:"body"`
	Priority string `json:"priority,omitempty"`
}

type supportTicketWithMessages struct {
	db.SupportTicket
	Messages []db.SupportTicketMessage `json:"messages"`
}

const (
	supportMaxSubjectRunes = 200
	supportMaxBodyRunes    = 4000
)

var supportValidCategories = map[string]bool{
	"billing":    true,
	"audit":      true,
	"bidding":    true,
	"creatives":  true,
	"publisher":  true,
	"technical":  true,
	"account":    true,
	"other":      true,
}

var supportValidPriorities = map[string]bool{
	"low":    true,
	"normal": true,
	"high":   true,
	"urgent": true,
}

func truncateRunes(s string, max int) string {
	if runes := []rune(s); len(runes) > max {
		return string(runes[:max])
	}
	return s
}

func (h *Handler) CreateSupportTicket(w http.ResponseWriter, r *http.Request) {
	reqType, reqID, reqName, reqEmail, ok := h.resolveRequester(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}

	var req createSupportTicketRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}
	req.Category = strings.TrimSpace(req.Category)
	req.Subject = strings.TrimSpace(req.Subject)
	req.Body = strings.TrimSpace(req.Body)
	req.Priority = strings.TrimSpace(req.Priority)

	if req.Category == "" || !supportValidCategories[req.Category] {
		writeError(w, http.StatusBadRequest, "Invalid category")
		return
	}
	if req.Subject == "" {
		writeError(w, http.StatusBadRequest, "Subject is required")
		return
	}
	if req.Body == "" {
		writeError(w, http.StatusBadRequest, "Body is required")
		return
	}
	if req.Priority == "" {
		req.Priority = "normal"
	}
	if !supportValidPriorities[req.Priority] {
		writeError(w, http.StatusBadRequest, "Invalid priority")
		return
	}

	ticket := db.SupportTicket{
		RequesterType:  reqType,
		RequesterID:    reqID,
		RequesterName:  reqName,
		RequesterEmail: reqEmail,
		Category:       req.Category,
		Subject:        truncateRunes(req.Subject, supportMaxSubjectRunes),
		Body:           truncateRunes(req.Body, supportMaxBodyRunes),
		Priority:       req.Priority,
	}

	created, err := h.Queries.CreateSupportTicket(r.Context(), ticket)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create ticket: "+err.Error())
		return
	}

	messages, err := h.Queries.ListSupportTicketMessages(r.Context(), created.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ticket created but failed to load thread: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, supportTicketWithMessages{
		SupportTicket: created,
		Messages:      messages,
	})
}

func (h *Handler) ListSupportTickets(w http.ResponseWriter, r *http.Request) {
	reqType, reqID, _, _, ok := h.resolveRequester(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	tickets, err := h.Queries.ListSupportTicketsForRequester(r.Context(), reqType, reqID, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to list tickets: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tickets": tickets})
}

func (h *Handler) GetSupportTicket(w http.ResponseWriter, r *http.Request) {
	reqType, reqID, _, _, ok := h.resolveRequester(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id required")
		return
	}
	ticket, err := h.Queries.GetSupportTicketForRequester(r.Context(), id, reqType, reqID)
	if err != nil {
		if errors.Is(err, db.ErrSupportTicketNotFound) {
			writeError(w, http.StatusNotFound, "Ticket not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "Failed to load ticket: "+err.Error())
		return
	}
	messages, err := h.Queries.ListSupportTicketMessages(r.Context(), ticket.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to load thread: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, supportTicketWithMessages{
		SupportTicket: ticket,
		Messages:      messages,
	})
}

type appendSupportMessageRequest struct {
	Body string `json:"body"`
}

func (h *Handler) AppendSupportMessage(w http.ResponseWriter, r *http.Request) {
	reqType, reqID, reqName, _, ok := h.resolveRequester(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id required")
		return
	}

	// Ownership check — only the original requester can post on their ticket.
	if _, err := h.Queries.GetSupportTicketForRequester(r.Context(), id, reqType, reqID); err != nil {
		if errors.Is(err, db.ErrSupportTicketNotFound) {
			writeError(w, http.StatusNotFound, "Ticket not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "Failed to load ticket: "+err.Error())
		return
	}

	var req appendSupportMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" {
		writeError(w, http.StatusBadRequest, "Body is required")
		return
	}
	body = truncateRunes(body, supportMaxBodyRunes)

	msg, err := h.Queries.AppendSupportTicketMessage(r.Context(), id, reqType, reqName, body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to append message: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}
