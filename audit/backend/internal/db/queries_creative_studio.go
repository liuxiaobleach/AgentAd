package db

import (
	"context"
	"fmt"
	"time"
)

const brandKitCols = `id, advertiser_id, name, description, voice_tone, primary_message,
	color_palette, mandatory_terms, banned_terms, visual_rules, cta_preferences,
	is_default, created_at, updated_at`

func scanBrandKit(row interface {
	Scan(dest ...any) error
}) (BrandKit, error) {
	var k BrandKit
	err := row.Scan(
		&k.ID, &k.AdvertiserID, &k.Name, &k.Description, &k.VoiceTone, &k.PrimaryMessage,
		&k.ColorPalette, &k.MandatoryTerms, &k.BannedTerms, &k.VisualRules, &k.CtaPreferences,
		&k.IsDefault, &k.CreatedAt, &k.UpdatedAt,
	)
	return k, err
}

func (q *Queries) ListBrandKits(ctx context.Context, advertiserID string) ([]BrandKit, error) {
	sql := `SELECT ` + brandKitCols + ` FROM brand_kits WHERE advertiser_id = $1 ORDER BY is_default DESC, created_at DESC`
	rows, err := q.Pool.Query(ctx, sql, advertiserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []BrandKit
	for rows.Next() {
		item, err := scanBrandKit(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (q *Queries) GetBrandKit(ctx context.Context, id, advertiserID string) (BrandKit, error) {
	sql := `SELECT ` + brandKitCols + ` FROM brand_kits WHERE id = $1 AND advertiser_id = $2`
	return scanBrandKit(q.Pool.QueryRow(ctx, sql, id, advertiserID))
}

func (q *Queries) CreateBrandKit(ctx context.Context, k BrandKit) (BrandKit, error) {
	k.ID = "bk_" + newID()[1:13]
	if k.IsDefault {
		if _, err := q.Pool.Exec(ctx, `UPDATE brand_kits SET is_default = FALSE, updated_at = NOW() WHERE advertiser_id = $1`, k.AdvertiserID); err != nil {
			return BrandKit{}, err
		}
	}
	sql := `INSERT INTO brand_kits
		(id, advertiser_id, name, description, voice_tone, primary_message, color_palette,
		 mandatory_terms, banned_terms, visual_rules, cta_preferences, is_default)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING ` + brandKitCols
	return scanBrandKit(q.Pool.QueryRow(ctx, sql,
		k.ID, k.AdvertiserID, k.Name, k.Description, k.VoiceTone, k.PrimaryMessage, k.ColorPalette,
		k.MandatoryTerms, k.BannedTerms, k.VisualRules, k.CtaPreferences, k.IsDefault,
	))
}

func (q *Queries) UpdateBrandKit(ctx context.Context, id, advertiserID string, k BrandKit) (BrandKit, error) {
	if k.IsDefault {
		if _, err := q.Pool.Exec(ctx, `UPDATE brand_kits SET is_default = FALSE, updated_at = NOW() WHERE advertiser_id = $1 AND id <> $2`, advertiserID, id); err != nil {
			return BrandKit{}, err
		}
	}
	sql := `UPDATE brand_kits
		SET name=$3, description=$4, voice_tone=$5, primary_message=$6, color_palette=$7,
		    mandatory_terms=$8, banned_terms=$9, visual_rules=$10, cta_preferences=$11,
		    is_default=$12, updated_at=NOW()
		WHERE id=$1 AND advertiser_id=$2
		RETURNING ` + brandKitCols
	return scanBrandKit(q.Pool.QueryRow(ctx, sql,
		id, advertiserID, k.Name, k.Description, k.VoiceTone, k.PrimaryMessage, k.ColorPalette,
		k.MandatoryTerms, k.BannedTerms, k.VisualRules, k.CtaPreferences, k.IsDefault,
	))
}

func (q *Queries) DeleteBrandKit(ctx context.Context, id, advertiserID string) error {
	const sql = `DELETE FROM brand_kits WHERE id = $1 AND advertiser_id = $2`
	ct, err := q.Pool.Exec(ctx, sql, id, advertiserID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("brand kit not found or not owned by advertiser")
	}
	return nil
}

const creativeStudioRunCols = `id, advertiser_id, brand_kit_id, title, brief, base_creative_name,
	project_name, landing_url, target_audiences, style_hint, aspect_ratio, variant_count,
	auto_submit_audit, status, created_at, updated_at, completed_at`

func scanCreativeStudioRun(row interface {
	Scan(dest ...any) error
}) (CreativeStudioRun, error) {
	var run CreativeStudioRun
	err := row.Scan(
		&run.ID, &run.AdvertiserID, &run.BrandKitID, &run.Title, &run.Brief, &run.BaseCreativeName,
		&run.ProjectName, &run.LandingURL, &run.TargetAudiences, &run.StyleHint, &run.AspectRatio, &run.VariantCount,
		&run.AutoSubmitAudit, &run.Status, &run.CreatedAt, &run.UpdatedAt, &run.CompletedAt,
	)
	return run, err
}

func (q *Queries) CreateCreativeStudioRun(ctx context.Context, run CreativeStudioRun) (CreativeStudioRun, error) {
	run.ID = "csr_" + newID()[1:13]
	sql := `INSERT INTO creative_studio_runs
		(id, advertiser_id, brand_kit_id, title, brief, base_creative_name, project_name, landing_url,
		 target_audiences, style_hint, aspect_ratio, variant_count, auto_submit_audit, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING ` + creativeStudioRunCols
	return scanCreativeStudioRun(q.Pool.QueryRow(ctx, sql,
		run.ID, run.AdvertiserID, run.BrandKitID, run.Title, run.Brief, run.BaseCreativeName, run.ProjectName, run.LandingURL,
		run.TargetAudiences, run.StyleHint, run.AspectRatio, run.VariantCount, run.AutoSubmitAudit, run.Status,
	))
}

func (q *Queries) GetCreativeStudioRun(ctx context.Context, id, advertiserID string) (CreativeStudioRun, error) {
	sql := `SELECT ` + creativeStudioRunCols + ` FROM creative_studio_runs WHERE id = $1 AND advertiser_id = $2`
	return scanCreativeStudioRun(q.Pool.QueryRow(ctx, sql, id, advertiserID))
}

func (q *Queries) ListCreativeStudioRuns(ctx context.Context, advertiserID string, limit int) ([]CreativeStudioRun, error) {
	if limit <= 0 {
		limit = 10
	}
	sql := `SELECT ` + creativeStudioRunCols + ` FROM creative_studio_runs
		WHERE advertiser_id = $1
		ORDER BY created_at DESC
		LIMIT $2`
	rows, err := q.Pool.Query(ctx, sql, advertiserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CreativeStudioRun
	for rows.Next() {
		run, err := scanCreativeStudioRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, run)
	}
	return out, rows.Err()
}

func (q *Queries) UpdateCreativeStudioRunStatus(ctx context.Context, id string, status CreativeStudioRunStatus, completedAt *time.Time) error {
	const sql = `
		UPDATE creative_studio_runs
		SET status = $1, updated_at = NOW(), completed_at = $2
		WHERE id = $3`
	_, err := q.Pool.Exec(ctx, sql, status, completedAt, id)
	return err
}

const creativeStudioItemReturnCols = `id, run_id, creative_id, variant_index, variant_label, variant_angle,
	phase, status, error, created_at, updated_at, completed_at`

const creativeStudioItemSelectCols = `i.id, i.run_id, i.creative_id, i.variant_index, i.variant_label, i.variant_angle,
	i.phase, i.status, i.error, i.created_at, i.updated_at, i.completed_at,
	c.creative_name, c.image_url, c.status`

func scanCreativeStudioItem(row interface {
	Scan(dest ...any) error
}) (CreativeStudioRunItem, error) {
	var item CreativeStudioRunItem
	err := row.Scan(
		&item.ID, &item.RunID, &item.CreativeID, &item.VariantIndex, &item.VariantLabel, &item.VariantAngle,
		&item.Phase, &item.Status, &item.Error, &item.CreatedAt, &item.UpdatedAt, &item.CompletedAt,
		&item.CreativeName, &item.ImageURL, &item.CreativeStatus,
	)
	return item, err
}

func scanCreativeStudioItemBase(row interface {
	Scan(dest ...any) error
}) (CreativeStudioRunItem, error) {
	var item CreativeStudioRunItem
	err := row.Scan(
		&item.ID, &item.RunID, &item.CreativeID, &item.VariantIndex, &item.VariantLabel, &item.VariantAngle,
		&item.Phase, &item.Status, &item.Error, &item.CreatedAt, &item.UpdatedAt, &item.CompletedAt,
	)
	return item, err
}

func (q *Queries) CreateCreativeStudioRunItem(ctx context.Context, item CreativeStudioRunItem) (CreativeStudioRunItem, error) {
	item.ID = "cri_" + newID()[1:13]
	sql := `INSERT INTO creative_studio_run_items
		(id, run_id, creative_id, variant_index, variant_label, variant_angle, phase, status, error, completed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING ` + creativeStudioItemReturnCols
	return scanCreativeStudioItemBase(q.Pool.QueryRow(ctx, sql,
		item.ID, item.RunID, item.CreativeID, item.VariantIndex, item.VariantLabel, item.VariantAngle,
		item.Phase, item.Status, item.Error, item.CompletedAt,
	))
}

func (q *Queries) ListCreativeStudioRunItems(ctx context.Context, runID string) ([]CreativeStudioRunItem, error) {
	sql := `SELECT ` + creativeStudioItemSelectCols + `
		FROM creative_studio_run_items i
		JOIN creatives c ON c.id = i.creative_id
		WHERE i.run_id = $1
		ORDER BY i.variant_index ASC`
	rows, err := q.Pool.Query(ctx, sql, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CreativeStudioRunItem
	for rows.Next() {
		item, err := scanCreativeStudioItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (q *Queries) UpdateCreativeStudioRunItemState(ctx context.Context, id string, phase string, status CreativeStudioItemStatus, errText *string, completedAt *time.Time) error {
	const sql = `
		UPDATE creative_studio_run_items
		SET phase = $1, status = $2, error = $3, completed_at = $4, updated_at = NOW()
		WHERE id = $5`
	_, err := q.Pool.Exec(ctx, sql, phase, status, errText, completedAt, id)
	return err
}
