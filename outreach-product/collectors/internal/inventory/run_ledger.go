package inventory

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (ledger *Ledger) startOrResume(
	ctx context.Context,
	source Source,
	mode Mode,
	restart bool,
) (runRecord, bool, error) {
	board := strings.TrimSpace(source.Board())
	scope := strings.TrimSpace(source.Scope())
	if board == "" || scope == "" {
		return runRecord{}, false, fmt.Errorf("collector source requires non-empty board and scope")
	}
	partitions := normalizeStrings(source.Partitions())
	transaction, err := ledger.db.BeginTx(ctx, nil)
	if err != nil {
		return runRecord{}, false, err
	}
	defer func() { _ = transaction.Rollback() }()
	if restart {
		timestamp := now()
		if _, err := transaction.ExecContext(
			ctx,
			`UPDATE collector_runs
			 SET status='canceled', finished_at=?, updated_at=?
			 WHERE board=? AND scope_key=? AND mode=?
			   AND status IN ('discovering','hydrating','partial')`,
			timestamp,
			timestamp,
			board,
			scope,
			mode,
		); err != nil {
			return runRecord{}, false, fmt.Errorf("cancel active %s refresh: %w", board, err)
		}
	}

	var record runRecord
	var partitionsJSON string
	var discoveryComplete, sourceComplete int
	err = transaction.QueryRowContext(
		ctx,
		`SELECT id, board, scope_key, mode, partitions_json,
		        discovery_complete, source_complete
		 FROM collector_runs
		 WHERE board=? AND scope_key=? AND mode=?
		   AND status IN ('discovering','hydrating','partial')
		 ORDER BY id DESC LIMIT 1`,
		board,
		scope,
		mode,
	).Scan(
		&record.ID,
		&record.Board,
		&record.Scope,
		&record.Mode,
		&partitionsJSON,
		&discoveryComplete,
		&sourceComplete,
	)
	if err == nil {
		if err := json.Unmarshal([]byte(partitionsJSON), &record.Partitions); err != nil {
			return runRecord{}, false, fmt.Errorf("decode persisted collector partitions: %w", err)
		}
		record.DiscoveryComplete = discoveryComplete != 0
		record.SourceComplete = sourceComplete != 0
		if err := transaction.Commit(); err != nil {
			return runRecord{}, false, err
		}
		return record, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return runRecord{}, false, fmt.Errorf("read active %s refresh: %w", board, err)
	}

	encodedPartitions, err := json.Marshal(partitions)
	if err != nil {
		return runRecord{}, false, err
	}
	timestamp := now()
	result, err := transaction.ExecContext(
		ctx,
		`INSERT INTO collector_runs
		 (board, scope_key, mode, partitions_json, status, started_at, updated_at)
		 VALUES (?, ?, ?, ?, 'discovering', ?, ?)`,
		board,
		scope,
		mode,
		string(encodedPartitions),
		timestamp,
		timestamp,
	)
	if err != nil {
		return runRecord{}, false, fmt.Errorf("start %s refresh: %w", board, err)
	}
	record.ID, err = result.LastInsertId()
	if err != nil {
		return runRecord{}, false, err
	}
	record.Board = board
	record.Scope = scope
	record.Mode = mode
	record.Partitions = partitions
	if err := transaction.Commit(); err != nil {
		return runRecord{}, false, err
	}
	return record, false, nil
}

func (ledger *Ledger) saveDiscovery(ctx context.Context, runID int64, discovery Discovery) error {
	transaction, err := ledger.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(ctx, `DELETE FROM collector_items WHERE run_id=?`, runID); err != nil {
		return fmt.Errorf("replace collector discovery ledger: %w", err)
	}
	timestamp := now()
	seen := make(map[string]struct{}, len(discovery.Items))
	ordinal := 0
	for _, item := range discovery.Items {
		item.ID = strings.TrimSpace(item.ID)
		item.SourceBoard = strings.TrimSpace(item.SourceBoard)
		if item.ID == "" {
			return fmt.Errorf("discovery item at ordinal %d has no stable ID", ordinal)
		}
		key := item.SourceBoard + "\x00" + item.ID
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		encoded, err := json.Marshal(item.Metadata)
		if err != nil {
			return err
		}
		if _, err := transaction.ExecContext(
			ctx,
			`INSERT INTO collector_items
			 (run_id, source_board, item_id, ordinal, metadata_json, status, discovered_at)
			 VALUES (?, ?, ?, ?, ?, 'discovered', ?)`,
			runID,
			item.SourceBoard,
			item.ID,
			ordinal,
			string(encoded),
			timestamp,
		); err != nil {
			return fmt.Errorf("persist discovery item %s: %w", item.ID, err)
		}
		ordinal++
	}
	evidence, err := json.Marshal(discovery.Evidence)
	if err != nil {
		return err
	}
	if _, err := transaction.ExecContext(
		ctx,
		`UPDATE collector_runs
		 SET status='hydrating', discovery_complete=1, source_complete=?,
		     discovery_evidence_json=?, discovered_count=?, error_detail='', updated_at=?
		 WHERE id=?`,
		boolInt(discovery.Complete),
		string(evidence),
		ordinal,
		timestamp,
		runID,
	); err != nil {
		return fmt.Errorf("finish collector discovery: %w", err)
	}
	return transaction.Commit()
}

func (ledger *Ledger) pending(ctx context.Context, runID int64, limit int) ([]pendingItem, error) {
	query := `SELECT source_board, item_id, metadata_json
		FROM collector_items
		WHERE run_id=? AND status!='hydrated'
		ORDER BY ordinal`
	arguments := []any{runID}
	if limit > 0 {
		query += ` LIMIT ?`
		arguments = append(arguments, limit)
	}
	rows, err := ledger.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("read pending collector items: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var items []pendingItem
	for rows.Next() {
		var item pendingItem
		var encoded string
		if err := rows.Scan(&item.Item.SourceBoard, &item.Item.ID, &encoded); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(encoded), &item.Item.Metadata); err != nil {
			return nil, fmt.Errorf("decode discovery item %s: %w", item.Item.ID, err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (ledger *Ledger) setRunError(ctx context.Context, runID int64, crawlErr error) error {
	_, err := ledger.db.ExecContext(
		ctx,
		`UPDATE collector_runs SET error_detail=?, updated_at=? WHERE id=?`,
		crawlErr.Error(),
		now(),
		runID,
	)
	return err
}

func (ledger *Ledger) finish(ctx context.Context, run runRecord) (RunResult, error) {
	result := RunResult{RunID: run.ID, Board: run.Board, Mode: run.Mode}
	err := ledger.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*),
		        COALESCE(SUM(status='hydrated'), 0),
		        COALESCE(SUM(status='failed'), 0),
		        COALESCE(SUM(status='discovered'), 0)
		 FROM collector_items WHERE run_id=?`,
		run.ID,
	).Scan(&result.Discovered, &result.Hydrated, &result.Failed, &result.Pending)
	if err != nil {
		return RunResult{}, err
	}
	result.Status = RunCompleted
	finishedAt := now()
	errorDetail := ""
	if result.Failed > 0 || result.Pending > 0 {
		result.Status = RunPartial
		finishedAt = ""
		errorDetail = fmt.Sprintf("%d failed and %d pending detail pages remain", result.Failed, result.Pending)
	}
	transaction, err := ledger.db.BeginTx(ctx, nil)
	if err != nil {
		return RunResult{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	if result.Status == RunCompleted && run.Mode == ModeFull && run.SourceComplete {
		if err := closeMissing(ctx, transaction, run); err != nil {
			return RunResult{}, err
		}
	}
	if _, err := transaction.ExecContext(
		ctx,
		`UPDATE collector_runs
		 SET status=?, hydrated_count=?, failed_count=?, error_detail=?,
		     finished_at=?, updated_at=? WHERE id=?`,
		result.Status,
		result.Hydrated,
		result.Failed,
		errorDetail,
		finishedAt,
		now(),
		run.ID,
	); err != nil {
		return RunResult{}, err
	}
	if err := transaction.Commit(); err != nil {
		return RunResult{}, err
	}
	return result, nil
}

func closeMissing(ctx context.Context, transaction *sql.Tx, run runRecord) error {
	arguments := []any{now(), now(), run.Board}
	partitionClause := ""
	if len(run.Partitions) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(run.Partitions)), ",")
		partitionClause = " AND source_board IN (" + placeholders + ")"
		for _, partition := range run.Partitions {
			arguments = append(arguments, partition)
		}
	}
	arguments = append(arguments, run.ID)
	query := `UPDATE jobs
		SET status='closed', closed_at=?, last_checked_at=?
		WHERE board=?` + partitionClause + `
		  AND status NOT IN ('closed','applied','ignored')
		  AND NOT EXISTS (
		    SELECT 1 FROM collector_items
		    WHERE run_id=?
		      AND source_board=jobs.source_board
		      AND item_id=jobs.job_id
		  )`
	if _, err := transaction.ExecContext(ctx, query, arguments...); err != nil {
		return fmt.Errorf("reconcile %s source inventory: %w", run.Board, err)
	}
	return nil
}

func normalizeStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func now() string {
	return time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
