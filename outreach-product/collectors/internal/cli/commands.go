package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/spf13/cobra"
)

const defaultDatabasePath = ".jobkit/jobs.sqlite"

type refreshFlags struct {
	baseURL         string
	databasePath    string
	detailLimit     int
	detailWorkers   int
	eslcafeSections []string
	jsonOutput      bool
	mode            string
	quiet           bool
	requestInterval time.Duration
	restart         bool
}

func newRefreshCommand() *cobra.Command {
	flags := refreshFlags{
		databasePath:    envOr("JOBKIT_JOBS_DB_PATH", defaultDatabasePath),
		mode:            string(inventory.ModeFull),
		detailWorkers:   1,
		requestInterval: durationEnv("JOBKIT_REQUEST_INTERVAL_SECONDS", time.Second),
	}
	command := &cobra.Command{
		Use:   "refresh <board>",
		Short: "Run or resume one source inventory refresh",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) (runErr error) {
			mode := inventory.Mode(strings.ToLower(strings.TrimSpace(flags.mode)))
			if !mode.Valid() {
				return fmt.Errorf("unsupported --mode %q; expected full or latest", flags.mode)
			}
			source, err := buildSource(sourceOptions{
				name:            arguments[0],
				baseURL:         flags.baseURL,
				requestInterval: flags.requestInterval,
				eslcafeSections: flags.eslcafeSections,
			})
			if err != nil {
				return err
			}
			ledger, err := inventory.OpenLedger(command.Context(), flags.databasePath)
			if err != nil {
				return err
			}
			defer func() { runErr = errors.Join(runErr, ledger.Close()) }()
			runner, err := inventory.NewRunner(ledger, source)
			if err != nil {
				return err
			}
			result, err := runner.Run(command.Context(), inventory.RunOptions{
				Mode:          mode,
				DetailLimit:   flags.detailLimit,
				DetailWorkers: flags.detailWorkers,
				Restart:       flags.restart,
				Progress: func(message string) {
					if !flags.quiet {
						_, _ = fmt.Fprintln(command.ErrOrStderr(), message)
					}
				},
			})
			if err != nil {
				return err
			}
			if flags.jsonOutput {
				if err := writeJSON(command, result); err != nil {
					return err
				}
			} else {
				_, err = fmt.Fprintf(
					command.OutOrStdout(),
					"refresh %d %s: %d discovered, %d hydrated, %d failed, %d pending\n",
					result.RunID,
					result.Status,
					result.Discovered,
					result.Hydrated,
					result.Failed,
					result.Pending,
				)
				if err != nil {
					return err
				}
			}
			if result.Status != inventory.RunCompleted {
				return inventory.PartialRunError{Result: result}
			}
			return nil
		},
	}
	command.Flags().StringVar(&flags.baseURL, "base-url", "", "Override the selected source origin")
	command.Flags().StringVar(&flags.databasePath, "db", flags.databasePath, "JobKit SQLite inventory path")
	command.Flags().IntVar(&flags.detailLimit, "detail-limit", 0, "Hydrate at most this many unfinished details (0 = all)")
	command.Flags().IntVar(&flags.detailWorkers, "detail-workers", flags.detailWorkers, "Maximum concurrent detail requests")
	command.Flags().StringSliceVar(&flags.eslcafeSections, "section", nil, "ESL Cafe section: china, international, or korea")
	command.Flags().BoolVar(&flags.jsonOutput, "json", false, "Write the result as JSON")
	command.Flags().StringVar(&flags.mode, "mode", flags.mode, "Refresh mode: full or latest")
	command.Flags().BoolVar(&flags.quiet, "quiet", false, "Suppress progress on stderr")
	command.Flags().DurationVar(&flags.requestInterval, "request-interval", flags.requestInterval, "Minimum interval between source requests")
	command.Flags().BoolVar(&flags.restart, "restart", false, "Cancel the active run for this exact source scope and rediscover")
	return command
}

func newRunsCommand() *cobra.Command {
	var board, databasePath string
	var limit int
	command := &cobra.Command{
		Use:   "runs",
		Short: "List persisted collector runs",
		RunE: func(command *cobra.Command, _ []string) (runErr error) {
			ledger, err := inventory.OpenLedger(command.Context(), databasePath)
			if err != nil {
				return err
			}
			defer func() { runErr = errors.Join(runErr, ledger.Close()) }()
			runs, err := ledger.ListRuns(command.Context(), normalizeSourceName(board), limit)
			if err != nil {
				return err
			}
			return writeJSON(command, runs)
		},
	}
	command.Flags().StringVar(&board, "board", "", "Filter by source board")
	command.Flags().StringVar(&databasePath, "db", envOr("JOBKIT_JOBS_DB_PATH", defaultDatabasePath), "JobKit SQLite inventory path")
	command.Flags().IntVar(&limit, "limit", 20, "Maximum runs to return")
	return command
}

func newJobsCommand() *cobra.Command {
	var board, databasePath, partition, status string
	var limit int
	command := &cobra.Command{
		Use:   "jobs",
		Short: "List collected source records",
		RunE: func(command *cobra.Command, _ []string) (runErr error) {
			if !inventory.ValidJobStatus(status) {
				return fmt.Errorf("unsupported --status %q", status)
			}
			ledger, err := inventory.OpenLedger(command.Context(), databasePath)
			if err != nil {
				return err
			}
			defer func() { runErr = errors.Join(runErr, ledger.Close()) }()
			jobs, err := ledger.ListJobs(
				command.Context(),
				normalizeSourceName(board),
				partition,
				status,
				limit,
			)
			if err != nil {
				return err
			}
			return writeJSON(command, jobs)
		},
	}
	command.Flags().StringVar(&board, "board", "", "Filter by source board")
	command.Flags().StringVar(&databasePath, "db", envOr("JOBKIT_JOBS_DB_PATH", defaultDatabasePath), "JobKit SQLite inventory path")
	command.Flags().IntVar(&limit, "limit", 20, "Maximum jobs to return")
	command.Flags().StringVar(&partition, "partition", "", "Filter by a board's source partition")
	command.Flags().StringVar(&status, "status", "", "Filter by active, stale, closed, ignored, or applied")
	return command
}

func newHTTPClient() (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &http.Client{Timeout: 60 * time.Second, Jar: jar}, nil
}

func writeJSON(command *cobra.Command, value any) error {
	encoder := json.NewEncoder(command.OutOrStdout())
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func durationEnv(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	seconds, err := strconv.ParseFloat(raw, 64)
	if err != nil || seconds < 0 {
		return fallback
	}
	return time.Duration(seconds * float64(time.Second))
}
