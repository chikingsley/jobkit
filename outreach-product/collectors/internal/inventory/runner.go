package inventory

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

// Runner coordinates source discovery, per-item commits, and resume.
type Runner struct {
	ledger *Ledger
	source Source
}

// NewRunner binds one source to a durable ledger.
func NewRunner(ledger *Ledger, source Source) (*Runner, error) {
	if ledger == nil || source == nil {
		return nil, fmt.Errorf("collector runner requires a ledger and source")
	}
	return &Runner{ledger: ledger, source: source}, nil
}

// Run discovers once and hydrates only unfinished records. Every detail outcome
// commits independently, so interruptions retain all completed work.
func (runner *Runner) Run(ctx context.Context, options RunOptions) (RunResult, error) {
	if !options.Mode.Valid() {
		return RunResult{}, fmt.Errorf("unsupported refresh mode %q", options.Mode)
	}
	if options.DetailLimit < 0 {
		return RunResult{}, fmt.Errorf("detail limit cannot be negative")
	}
	if options.DetailWorkers < 0 {
		return RunResult{}, fmt.Errorf("detail workers cannot be negative")
	}
	run, resumed, err := runner.ledger.startOrResume(ctx, runner.source, options.Mode, options.Restart)
	if err != nil {
		return RunResult{}, err
	}
	report(options.Progress, fmt.Sprintf("refresh %d: %s", run.ID, resumeWord(resumed)))

	if !run.DiscoveryComplete {
		report(options.Progress, fmt.Sprintf("discovering %s %s inventory", run.Board, run.Mode))
		discovery, err := runner.source.Discover(ctx, run.Mode)
		if err != nil {
			_ = runner.ledger.setRunError(ctx, run.ID, err)
			return RunResult{}, err
		}
		if run.Mode == ModeFull && !discovery.Complete {
			err := fmt.Errorf("%s did not prove complete source discovery", run.Board)
			_ = runner.ledger.setRunError(ctx, run.ID, err)
			return RunResult{}, err
		}
		if err := runner.ledger.saveDiscovery(ctx, run.ID, discovery); err != nil {
			return RunResult{}, err
		}
		run.DiscoveryComplete = true
		run.SourceComplete = discovery.Complete
		report(options.Progress, fmt.Sprintf("discovered %d stable source identities", len(discovery.Items)))
	}

	items, err := runner.ledger.pending(ctx, run.ID, options.DetailLimit)
	if err != nil {
		return RunResult{}, err
	}
	workers := options.DetailWorkers
	if workers == 0 {
		workers = 1
	}
	if err := runner.hydratePending(ctx, run, items, workers, options.Progress); err != nil {
		_ = runner.ledger.setRunError(ctx, run.ID, err)
		return RunResult{}, err
	}

	result, err := runner.ledger.finish(ctx, run)
	if err != nil {
		return RunResult{}, err
	}
	result.Resumed = resumed
	return result, nil
}

type indexedPendingItem struct {
	index int
	item  pendingItem
}

func (runner *Runner) hydratePending(
	ctx context.Context,
	run runRecord,
	items []pendingItem,
	workers int,
	progress func(string),
) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	work := make(chan indexedPendingItem)
	var group sync.WaitGroup
	var firstError error
	var errorOnce sync.Once
	recordError := func(err error) {
		errorOnce.Do(func() {
			firstError = err
			cancel()
		})
	}
	for range workers {
		group.Add(1)
		go func() {
			defer group.Done()
			for indexed := range work {
				if err := runner.hydrateOne(ctx, run, indexed, len(items), progress); err != nil {
					recordError(err)
					return
				}
			}
		}()
	}
sendLoop:
	for index, item := range items {
		select {
		case <-ctx.Done():
			break sendLoop
		case work <- indexedPendingItem{index: index, item: item}:
		}
	}
	close(work)
	group.Wait()
	if firstError != nil {
		return firstError
	}
	return ctx.Err()
}

func (runner *Runner) hydrateOne(
	ctx context.Context,
	run runRecord,
	indexed indexedPendingItem,
	total int,
	progress func(string),
) error {
	if err := runner.ledger.recordAttempt(ctx, run.ID, indexed.item); err != nil {
		return err
	}
	record, hydrateErr := runner.source.Hydrate(ctx, indexed.item.Item)
	if hydrateErr != nil {
		if ctx.Err() != nil {
			return nil
		}
		if err := runner.ledger.recordFailure(ctx, run.ID, indexed.item, hydrateErr); err != nil {
			return err
		}
		report(progress, fmt.Sprintf("detail %d/%d failed: %s", indexed.index+1, total, indexed.item.Item.ID))
		var retryable interface{ Retryable() bool }
		if errors.As(hydrateErr, &retryable) && retryable.Retryable() {
			return fmt.Errorf("retryable source failure for %s: %w", indexed.item.Item.ID, hydrateErr)
		}
		return nil
	}
	if record.Board == "" {
		record.Board = run.Board
	}
	if record.SourceBoard == "" {
		record.SourceBoard = indexed.item.Item.SourceBoard
	}
	if record.JobID == "" {
		record.JobID = indexed.item.Item.ID
	}
	if err := runner.ledger.recordSuccess(ctx, run.ID, indexed.item, record); err != nil {
		return err
	}
	report(progress, fmt.Sprintf("detail %d/%d hydrated: %s", indexed.index+1, total, indexed.item.Item.ID))
	return nil
}

func report(progress func(string), message string) {
	if progress != nil {
		progress(message)
	}
}

func resumeWord(resumed bool) string {
	if resumed {
		return "resuming"
	}
	return "started"
}
