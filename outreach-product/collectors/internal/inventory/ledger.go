package inventory

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// Ledger owns durable source runs and canonical source records.
type Ledger struct {
	db   *sql.DB
	path string
}

type runRecord struct {
	ID                int64
	Board             string
	Scope             string
	Mode              Mode
	Partitions        []string
	DiscoveryComplete bool
	SourceComplete    bool
}

type pendingItem struct {
	Item Item
}

// OpenLedger opens or creates a project-owned SQLite inventory.
func OpenLedger(ctx context.Context, databasePath string) (*Ledger, error) {
	if strings.TrimSpace(databasePath) == "" {
		return nil, fmt.Errorf("collector ledger requires a database path")
	}
	directory := filepath.Dir(databasePath)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create JobKit database directory: %w", err)
	}
	dsn := databasePath + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)"
	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open JobKit database: %w", err)
	}
	database.SetMaxOpenConns(2)
	ledger := &Ledger{db: database, path: databasePath}
	if err := ledger.initialize(ctx); err != nil {
		_ = database.Close()
		return nil, err
	}
	ledger.hardenFiles()
	return ledger, nil
}

func (ledger *Ledger) initialize(ctx context.Context) error {
	for _, statement := range schemaStatements {
		if _, err := ledger.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize JobKit collector schema: %w", err)
		}
	}
	return ledger.applySchemaMigrations(ctx)
}

func (ledger *Ledger) applySchemaMigrations(ctx context.Context) error {
	var applied int
	if err := ledger.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM collector_schema_migrations WHERE version=1`,
	).Scan(&applied); err != nil {
		return fmt.Errorf("read collector schema version: %w", err)
	}
	if applied == 0 {
		hasSourceBoard, err := ledger.jobsColumnExists(ctx, "source_board")
		if err != nil {
			return err
		}
		transaction, err := ledger.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer func() { _ = transaction.Rollback() }()
		if !hasSourceBoard {
			if _, err := transaction.ExecContext(
				ctx,
				`ALTER TABLE jobs ADD COLUMN source_board TEXT NOT NULL DEFAULT ''`,
			); err != nil {
				return fmt.Errorf("apply collector schema migration 1: %w", err)
			}
		}
		if _, err := transaction.ExecContext(
			ctx,
			`UPDATE jobs
			 SET source_board = CASE
			   WHEN json_valid(raw_json) THEN CASE json_extract(raw_json, '$.fields.board_slug')
			     WHEN 'china' THEN 'china'
			     WHEN 'international' THEN 'international'
			     WHEN 'korea' THEN 'korea'
			     ELSE ''
			   END
			   ELSE ''
			 END
			 WHERE board='eslcafe-modern' AND source_board=''`,
		); err != nil {
			return fmt.Errorf("backfill ESL Cafe source partitions: %w", err)
		}
		if _, err := transaction.ExecContext(
			ctx,
			`INSERT INTO collector_schema_migrations(version,applied_at) VALUES (1,?)`,
			now(),
		); err != nil {
			return fmt.Errorf("record collector schema migration 1: %w", err)
		}
		if err := transaction.Commit(); err != nil {
			return err
		}
	}
	if _, err := ledger.db.ExecContext(
		ctx,
		`CREATE INDEX IF NOT EXISTS idx_jobs_source_board ON jobs(board, source_board)`,
	); err != nil {
		return fmt.Errorf("index jobs source partition: %w", err)
	}
	return nil
}

func (ledger *Ledger) jobsColumnExists(ctx context.Context, wanted string) (bool, error) {
	rows, err := ledger.db.QueryContext(ctx, `PRAGMA table_info(jobs)`)
	if err != nil {
		return false, fmt.Errorf("inspect jobs schema: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var columnID int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(
			&columnID,
			&name,
			&columnType,
			&notNull,
			&defaultValue,
			&primaryKey,
		); err != nil {
			return false, fmt.Errorf("read jobs schema: %w", err)
		}
		if name == wanted {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("read jobs schema: %w", err)
	}
	return false, nil
}

// Close closes the SQLite handle and hardens files created during the run.
func (ledger *Ledger) Close() error {
	err := ledger.db.Close()
	ledger.hardenFiles()
	return err
}

func (ledger *Ledger) hardenFiles() {
	for _, path := range []string{ledger.path, ledger.path + "-wal", ledger.path + "-shm"} {
		info, err := os.Lstat(path)
		if err == nil && info.Mode().IsRegular() {
			_ = os.Chmod(path, 0o600)
		}
	}
}
