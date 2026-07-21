package inventory

import (
	"context"
	"encoding/json"
	"fmt"
)

// ListRuns returns the newest persisted collector runs, optionally for one board.
func (ledger *Ledger) ListRuns(ctx context.Context, board string, limit int) ([]RunSummary, error) {
	if limit <= 0 {
		limit = 20
	}
	query := `SELECT id, board, scope_key, mode, status, partitions_json,
	                 discovered_count, hydrated_count, failed_count, started_at,
	                 finished_at, error_detail, source_complete
	          FROM collector_runs`
	arguments := []any{}
	if board != "" {
		query += ` WHERE board=?`
		arguments = append(arguments, board)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	arguments = append(arguments, limit)
	rows, err := ledger.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	runs := make([]RunSummary, 0)
	for rows.Next() {
		var run RunSummary
		var partitionsJSON string
		var sourceComplete int
		if err := rows.Scan(
			&run.ID,
			&run.Board,
			&run.Scope,
			&run.Mode,
			&run.Status,
			&partitionsJSON,
			&run.Discovered,
			&run.Hydrated,
			&run.Failed,
			&run.StartedAt,
			&run.FinishedAt,
			&run.ErrorDetail,
			&sourceComplete,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(partitionsJSON), &run.Partitions); err != nil {
			return nil, fmt.Errorf("decode collector run partitions: %w", err)
		}
		run.SourceProven = sourceComplete != 0
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

// ListJobs returns source inventory rows, optionally filtered by board,
// partition, and status.
func (ledger *Ledger) ListJobs(
	ctx context.Context,
	board string,
	partition string,
	status string,
	limit int,
) ([]StoredRecord, error) {
	if limit <= 0 {
		limit = 20
	}
	query := `SELECT board, source_board, job_id, url, title, company, location,
	                 country, salary, currency, degree_required,
	                 eu_passport_required, contract_length, start_date,
	                 apply_email, apply_url, posted_date, description, raw,
	                 normalized_json, status, first_seen_at, last_seen_at
	          FROM jobs WHERE 1=1`
	arguments := []any{}
	if board != "" {
		query += ` AND board=?`
		arguments = append(arguments, board)
	}
	if partition != "" {
		query += ` AND source_board=?`
		arguments = append(arguments, partition)
	}
	if status != "" {
		query += ` AND status=?`
		arguments = append(arguments, status)
	}
	query += ` ORDER BY last_seen_at DESC, board, source_board, job_id LIMIT ?`
	arguments = append(arguments, limit)
	rows, err := ledger.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	jobs := make([]StoredRecord, 0)
	for rows.Next() {
		var job StoredRecord
		var normalizedJSON string
		if err := rows.Scan(
			&job.Board,
			&job.SourceBoard,
			&job.JobID,
			&job.URL,
			&job.Title,
			&job.Company,
			&job.Location,
			&job.Country,
			&job.Salary,
			&job.Currency,
			&job.DegreeRequired,
			&job.EUPassportRequired,
			&job.ContractLength,
			&job.StartDate,
			&job.ApplyEmail,
			&job.ApplyURL,
			&job.PostedDate,
			&job.Description,
			&job.Raw,
			&normalizedJSON,
			&job.Status,
			&job.FirstSeenAt,
			&job.LastSeenAt,
		); err != nil {
			return nil, err
		}
		var normalized Record
		if err := json.Unmarshal([]byte(normalizedJSON), &normalized); err == nil {
			job.Fields = normalized.Fields
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}
