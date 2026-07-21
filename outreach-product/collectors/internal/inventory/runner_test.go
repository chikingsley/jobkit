package inventory

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type fakeSource struct {
	failureErrors map[string]error
	items         []Item
	failures      map[string]int
	hydrations    map[string]int
	mutex         sync.Mutex
}

func (source *fakeSource) Board() string        { return "fake" }
func (source *fakeSource) Scope() string        { return "all" }
func (source *fakeSource) Partitions() []string { return nil }

func (source *fakeSource) Discover(_ context.Context, mode Mode) (Discovery, error) {
	return Discovery{
		Items:    append([]Item(nil), source.items...),
		Complete: mode == ModeFull,
		Evidence: map[string]string{"test": "true"},
	}, nil
}

func (source *fakeSource) Hydrate(_ context.Context, item Item) (Record, error) {
	source.mutex.Lock()
	source.hydrations[item.ID]++
	if source.failures[item.ID] > 0 {
		source.failures[item.ID]--
		failure := source.failureErrors[item.ID]
		source.mutex.Unlock()
		if failure != nil {
			return Record{}, failure
		}
		return Record{}, errors.New("forced detail failure")
	}
	source.mutex.Unlock()
	return Record{
		Board:       source.Board(),
		JobID:       item.ID,
		URL:         "https://example.test/jobs/" + item.ID,
		Title:       "Job " + item.ID,
		Description: "Exact source text",
		Raw:         "Exact source text",
	}, nil
}

type retryableTestError struct{}

func (retryableTestError) Error() string   { return "retry later" }
func (retryableTestError) Retryable() bool { return true }

func TestRunnerStopsOnRetryableSourceFailureAndResumes(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ledger, err := OpenLedger(ctx, filepath.Join(t.TempDir(), "jobs.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	source := &fakeSource{
		failureErrors: map[string]error{"a": retryableTestError{}},
		items:         []Item{{ID: "a"}, {ID: "b"}, {ID: "c"}},
		failures:      map[string]int{"a": 1},
		hydrations:    map[string]int{},
	}
	runner, err := NewRunner(ledger, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runner.Run(ctx, RunOptions{Mode: ModeFull}); err == nil {
		t.Fatal("expected retryable source failure")
	}
	if source.hydrations["a"] != 1 || source.hydrations["b"] != 0 || source.hydrations["c"] != 0 {
		t.Fatalf("hydrations after retryable failure = %#v", source.hydrations)
	}
	result, err := runner.Run(ctx, RunOptions{Mode: ModeFull})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != RunCompleted || !result.Resumed {
		t.Fatalf("resumed result = %#v", result)
	}
	if source.hydrations["a"] != 2 || source.hydrations["b"] != 1 || source.hydrations["c"] != 1 {
		t.Fatalf("hydrations after resume = %#v", source.hydrations)
	}
}

func TestRunnerResumesOnlyUnfinishedDetails(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ledger, err := OpenLedger(ctx, filepath.Join(t.TempDir(), "jobs.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	source := &fakeSource{
		items:      []Item{{ID: "a"}, {ID: "b"}},
		failures:   map[string]int{"b": 1},
		hydrations: map[string]int{},
	}
	runner, err := NewRunner(ledger, source)
	if err != nil {
		t.Fatal(err)
	}
	first, err := runner.Run(ctx, RunOptions{Mode: ModeFull, DetailWorkers: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != RunPartial || first.Hydrated != 1 || first.Failed != 1 {
		t.Fatalf("first result = %#v", first)
	}
	second, err := runner.Run(ctx, RunOptions{Mode: ModeFull, DetailWorkers: 2})
	if err != nil {
		t.Fatal(err)
	}
	if second.Status != RunCompleted || !second.Resumed {
		t.Fatalf("second result = %#v", second)
	}
	if source.hydrations["a"] != 1 || source.hydrations["b"] != 2 {
		t.Fatalf("hydrations = %#v", source.hydrations)
	}
}

func TestOnlyCompleteFullRunClosesMissingRecords(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ledger, err := OpenLedger(ctx, filepath.Join(t.TempDir(), "jobs.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	source := &fakeSource{
		items:      []Item{{ID: "a"}, {ID: "b"}},
		failures:   map[string]int{},
		hydrations: map[string]int{},
	}
	runner, err := NewRunner(ledger, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runner.Run(ctx, RunOptions{Mode: ModeFull}); err != nil {
		t.Fatal(err)
	}
	source.items = []Item{{ID: "a"}}
	if _, err := runner.Run(ctx, RunOptions{Mode: ModeLatest}); err != nil {
		t.Fatal(err)
	}
	jobs, err := ledger.ListJobs(ctx, "fake", "", "active", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 2 {
		t.Fatalf("latest run closed a record: %#v", jobs)
	}
	if _, err := runner.Run(ctx, RunOptions{Mode: ModeFull}); err != nil {
		t.Fatal(err)
	}
	closed, err := ledger.ListJobs(ctx, "fake", "", "closed", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(closed) != 1 || closed[0].JobID != "b" {
		t.Fatalf("closed records = %#v", closed)
	}
}

func TestMigrationBackfillsLegacyESLCafePartition(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "jobs.sqlite")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	legacySchema := strings.Replace(
		schemaStatements[0],
		"\n\t\tsource_board TEXT NOT NULL DEFAULT '',",
		"",
		1,
	)
	if _, err := database.ExecContext(ctx, legacySchema); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(
		ctx,
		`INSERT INTO jobs(board,job_id,raw_json)
		 VALUES ('eslcafe-modern','partitioned','{"fields":{"board_slug":"korea"}}'),
		        ('eslcafe-modern','unknown','{}')`,
	); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	ledger, err := OpenLedger(ctx, databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	var partitioned, unknown string
	if err := ledger.db.QueryRowContext(
		ctx,
		`SELECT source_board FROM jobs WHERE job_id='partitioned'`,
	).Scan(&partitioned); err != nil {
		t.Fatal(err)
	}
	if err := ledger.db.QueryRowContext(
		ctx,
		`SELECT source_board FROM jobs WHERE job_id='unknown'`,
	).Scan(&unknown); err != nil {
		t.Fatal(err)
	}
	if partitioned != "korea" || unknown != "" {
		t.Fatalf("source partitions = %q, %q", partitioned, unknown)
	}
}
