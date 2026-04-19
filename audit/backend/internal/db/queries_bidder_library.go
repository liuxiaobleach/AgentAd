package db

import (
	"context"
	"fmt"
)

// Per-advertiser library of reusable strategy templates and agent skills,
// surfaced alongside built-in presets in the bidder-agents UI.

const bidderTemplateCols = `id, advertiser_id, name, icon, description, prompt,
	value_per_click, max_bid_cpm, created_at, updated_at`

func (q *Queries) ListStrategyTemplates(ctx context.Context, advertiserID string) ([]BidderStrategyTemplate, error) {
	sql := `SELECT ` + bidderTemplateCols + `
		FROM bidder_strategy_templates
		WHERE advertiser_id = $1
		ORDER BY created_at DESC`
	rows, err := q.Pool.Query(ctx, sql, advertiserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []BidderStrategyTemplate
	for rows.Next() {
		var t BidderStrategyTemplate
		if err := rows.Scan(
			&t.ID, &t.AdvertiserID, &t.Name, &t.Icon, &t.Description, &t.Prompt,
			&t.ValuePerClick, &t.MaxBidCpm, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (q *Queries) CreateStrategyTemplate(ctx context.Context, t BidderStrategyTemplate) (BidderStrategyTemplate, error) {
	t.ID = "bst_" + newID()[1:13]
	sql := `INSERT INTO bidder_strategy_templates
		(id, advertiser_id, name, icon, description, prompt, value_per_click, max_bid_cpm)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING ` + bidderTemplateCols
	var out BidderStrategyTemplate
	err := q.Pool.QueryRow(ctx, sql,
		t.ID, t.AdvertiserID, t.Name, t.Icon, t.Description, t.Prompt,
		t.ValuePerClick, t.MaxBidCpm,
	).Scan(
		&out.ID, &out.AdvertiserID, &out.Name, &out.Icon, &out.Description, &out.Prompt,
		&out.ValuePerClick, &out.MaxBidCpm, &out.CreatedAt, &out.UpdatedAt,
	)
	return out, err
}

func (q *Queries) UpdateStrategyTemplate(ctx context.Context, id, advertiserID string, t BidderStrategyTemplate) (BidderStrategyTemplate, error) {
	sql := `UPDATE bidder_strategy_templates
		SET name=$3, icon=$4, description=$5, prompt=$6, value_per_click=$7, max_bid_cpm=$8, updated_at=NOW()
		WHERE id=$1 AND advertiser_id=$2
		RETURNING ` + bidderTemplateCols
	var out BidderStrategyTemplate
	err := q.Pool.QueryRow(ctx, sql,
		id, advertiserID, t.Name, t.Icon, t.Description, t.Prompt,
		t.ValuePerClick, t.MaxBidCpm,
	).Scan(
		&out.ID, &out.AdvertiserID, &out.Name, &out.Icon, &out.Description, &out.Prompt,
		&out.ValuePerClick, &out.MaxBidCpm, &out.CreatedAt, &out.UpdatedAt,
	)
	return out, err
}

func (q *Queries) DeleteStrategyTemplate(ctx context.Context, id, advertiserID string) error {
	const sql = `DELETE FROM bidder_strategy_templates WHERE id=$1 AND advertiser_id=$2`
	ct, err := q.Pool.Exec(ctx, sql, id, advertiserID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("template not found or not owned by advertiser")
	}
	return nil
}

const bidderSkillCols = `id, advertiser_id, name, icon, description, prompt_snippet,
	created_at, updated_at`

func (q *Queries) ListAgentSkills(ctx context.Context, advertiserID string) ([]BidderAgentSkill, error) {
	sql := `SELECT ` + bidderSkillCols + `
		FROM bidder_agent_skills
		WHERE advertiser_id = $1
		ORDER BY created_at DESC`
	rows, err := q.Pool.Query(ctx, sql, advertiserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []BidderAgentSkill
	for rows.Next() {
		var s BidderAgentSkill
		if err := rows.Scan(
			&s.ID, &s.AdvertiserID, &s.Name, &s.Icon, &s.Description, &s.PromptSnippet,
			&s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (q *Queries) CreateAgentSkill(ctx context.Context, s BidderAgentSkill) (BidderAgentSkill, error) {
	s.ID = "bas_" + newID()[1:13]
	sql := `INSERT INTO bidder_agent_skills
		(id, advertiser_id, name, icon, description, prompt_snippet)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING ` + bidderSkillCols
	var out BidderAgentSkill
	err := q.Pool.QueryRow(ctx, sql,
		s.ID, s.AdvertiserID, s.Name, s.Icon, s.Description, s.PromptSnippet,
	).Scan(
		&out.ID, &out.AdvertiserID, &out.Name, &out.Icon, &out.Description, &out.PromptSnippet,
		&out.CreatedAt, &out.UpdatedAt,
	)
	return out, err
}

func (q *Queries) UpdateAgentSkill(ctx context.Context, id, advertiserID string, s BidderAgentSkill) (BidderAgentSkill, error) {
	sql := `UPDATE bidder_agent_skills
		SET name=$3, icon=$4, description=$5, prompt_snippet=$6, updated_at=NOW()
		WHERE id=$1 AND advertiser_id=$2
		RETURNING ` + bidderSkillCols
	var out BidderAgentSkill
	err := q.Pool.QueryRow(ctx, sql,
		id, advertiserID, s.Name, s.Icon, s.Description, s.PromptSnippet,
	).Scan(
		&out.ID, &out.AdvertiserID, &out.Name, &out.Icon, &out.Description, &out.PromptSnippet,
		&out.CreatedAt, &out.UpdatedAt,
	)
	return out, err
}

func (q *Queries) DeleteAgentSkill(ctx context.Context, id, advertiserID string) error {
	const sql = `DELETE FROM bidder_agent_skills WHERE id=$1 AND advertiser_id=$2`
	ct, err := q.Pool.Exec(ctx, sql, id, advertiserID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("skill not found or not owned by advertiser")
	}
	return nil
}
