package inventory

import (
	"context"
	"encoding/json"
	"fmt"
)

func (ledger *Ledger) recordAttempt(ctx context.Context, runID int64, item pendingItem) error {
	_, err := ledger.db.ExecContext(
		ctx,
		`UPDATE collector_items
		 SET attempts=attempts+1, last_attempt_at=?
		 WHERE run_id=? AND source_board=? AND item_id=?`,
		now(),
		runID,
		item.Item.SourceBoard,
		item.Item.ID,
	)
	return err
}

func (ledger *Ledger) recordFailure(ctx context.Context, runID int64, item pendingItem, crawlErr error) error {
	detail := crawlErr.Error()
	if len(detail) > 4000 {
		detail = detail[:4000]
	}
	_, err := ledger.db.ExecContext(
		ctx,
		`UPDATE collector_items
		 SET status='failed', error_detail=?
		 WHERE run_id=? AND source_board=? AND item_id=?`,
		detail,
		runID,
		item.Item.SourceBoard,
		item.Item.ID,
	)
	return err
}

func (ledger *Ledger) recordSuccess(ctx context.Context, runID int64, item pendingItem, record Record) error {
	if record.Board == "" || record.JobID == "" {
		return fmt.Errorf("hydrated record requires board and job ID")
	}
	rawJSON, normalizedJSON, err := encodeRecord(record)
	if err != nil {
		return err
	}
	timestamp := now()
	transaction, err := ledger.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(
		ctx,
		`INSERT INTO jobs (
			board, job_id, source_board, url, title, company, location, country,
			salary, currency, degree_required, eu_passport_required, contract_length,
			start_date, apply_email, apply_url, posted_date, description, raw, raw_json,
			normalized_json, status, first_seen_at, last_seen_at, last_present_at,
			last_checked_at, closed_at, last_run_id
		 ) VALUES (
			?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
			'active', ?, ?, ?, ?, '', ?
		 ) ON CONFLICT(board, job_id) DO UPDATE SET
			source_board=excluded.source_board,
			url=excluded.url,
			title=excluded.title,
			company=excluded.company,
			location=excluded.location,
			country=excluded.country,
			salary=excluded.salary,
			currency=excluded.currency,
			degree_required=excluded.degree_required,
			eu_passport_required=excluded.eu_passport_required,
			contract_length=excluded.contract_length,
			start_date=excluded.start_date,
			apply_email=excluded.apply_email,
			apply_url=excluded.apply_url,
			posted_date=excluded.posted_date,
			description=excluded.description,
			raw=excluded.raw,
			raw_json=excluded.raw_json,
			normalized_json=excluded.normalized_json,
			status=CASE WHEN jobs.status IN ('applied','ignored') THEN jobs.status ELSE 'active' END,
			last_seen_at=excluded.last_seen_at,
			last_present_at=excluded.last_present_at,
			last_checked_at=excluded.last_checked_at,
			closed_at=CASE WHEN jobs.status IN ('applied','ignored') THEN jobs.closed_at ELSE '' END,
			last_run_id=excluded.last_run_id`,
		record.Board,
		record.JobID,
		record.SourceBoard,
		record.URL,
		record.Title,
		record.Company,
		record.Location,
		record.Country,
		record.Salary,
		record.Currency,
		record.DegreeRequired,
		record.EUPassportRequired,
		record.ContractLength,
		record.StartDate,
		record.ApplyEmail,
		record.ApplyURL,
		record.PostedDate,
		record.Description,
		record.Raw,
		rawJSON,
		normalizedJSON,
		timestamp,
		timestamp,
		timestamp,
		timestamp,
		runID,
	); err != nil {
		return fmt.Errorf("upsert %s posting %s: %w", record.Board, record.JobID, err)
	}
	if _, err := transaction.ExecContext(
		ctx,
		`UPDATE collector_items
		 SET status='hydrated', error_detail='', hydrated_at=?
		 WHERE run_id=? AND source_board=? AND item_id=?`,
		timestamp,
		runID,
		item.Item.SourceBoard,
		item.Item.ID,
	); err != nil {
		return err
	}
	return transaction.Commit()
}

func encodeRecord(record Record) (string, string, error) {
	fields := make(map[string]string, len(record.Fields)+5)
	for key, value := range record.Fields {
		fields[key] = value
	}
	fields["company"] = record.Company
	fields["posted"] = record.PostedDate
	fields["apply_url"] = record.ApplyURL
	fields["body"] = record.Description
	fields["raw"] = record.Raw
	raw := map[string]any{
		"board":       record.Board,
		"job_id":      record.JobID,
		"url":         record.URL,
		"title":       record.Title,
		"location":    record.Location,
		"apply_email": record.ApplyEmail,
		"fields":      fields,
	}
	rawBytes, err := json.Marshal(raw)
	if err != nil {
		return "", "", err
	}
	normalizedBytes, err := json.Marshal(record)
	if err != nil {
		return "", "", err
	}
	return string(rawBytes), string(normalizedBytes), nil
}
