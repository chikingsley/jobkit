package inventory

import (
	"context"
	"fmt"
	"strings"
)

const (
	RunDiscovering = "discovering"
	RunHydrating   = "hydrating"
	RunPartial     = "partial"
	RunCompleted   = "completed"
	RunCanceled    = "canceled"
)

// Mode controls how much of a source is discovered. Only a source-complete
// full run may reconcile listings that disappeared from the board.
type Mode string

const (
	ModeFull   Mode = "full"
	ModeLatest Mode = "latest"
)

// Valid reports whether the mode is accepted by the collector runner.
func (mode Mode) Valid() bool {
	return mode == ModeFull || mode == ModeLatest
}

// Item is one stable source identity discovered before its detail page is read.
// Metadata contains only source facts needed to hydrate that identity.
type Item struct {
	ID          string            `json:"id"`
	SourceBoard string            `json:"source_board,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// Discovery is a durable source inventory plus the evidence used to decide
// whether it is complete enough for absence reconciliation.
type Discovery struct {
	Items    []Item            `json:"items"`
	Complete bool              `json:"complete"`
	Evidence map[string]string `json:"evidence"`
}

// Record is the source-only inventory boundary. Canonical columns may be
// populated from explicit structured or labeled source fields. Interpretation
// of prose belongs to the separate evidence-backed analysis stage.
type Record struct {
	Board              string            `json:"board"`
	JobID              string            `json:"job_id"`
	SourceBoard        string            `json:"source_board,omitempty"`
	URL                string            `json:"url"`
	Title              string            `json:"title"`
	Company            string            `json:"company"`
	Location           string            `json:"location"`
	Country            string            `json:"country"`
	Salary             string            `json:"salary"`
	Currency           string            `json:"currency"`
	DegreeRequired     string            `json:"degree_required"`
	EUPassportRequired string            `json:"eu_passport_required"`
	ContractLength     string            `json:"contract_length"`
	StartDate          string            `json:"start_date"`
	ApplyEmail         string            `json:"apply_email"`
	ApplyURL           string            `json:"apply_url"`
	PostedDate         string            `json:"posted_date"`
	Description        string            `json:"description"`
	Raw                string            `json:"raw"`
	Fields             map[string]string `json:"fields,omitempty"`
}

// StoredRecord adds local inventory state to a source record.
type StoredRecord struct {
	Record
	Status      string `json:"status"`
	FirstSeenAt string `json:"first_seen_at"`
	LastSeenAt  string `json:"last_seen_at"`
}

// Source is the narrow contract implemented by each package under
// internal/boards. Scope and Partitions make resumability and reconciliation
// explicit rather than encoding board-specific policy in the ledger.
type Source interface {
	Board() string
	Scope() string
	Partitions() []string
	Discover(context.Context, Mode) (Discovery, error)
	Hydrate(context.Context, Item) (Record, error)
}

// RunOptions controls one resumable refresh invocation.
type RunOptions struct {
	Mode          Mode
	DetailLimit   int
	DetailWorkers int
	Restart       bool
	Progress      func(string)
}

// RunResult is the durable state after one refresh invocation.
type RunResult struct {
	RunID      int64  `json:"run_id"`
	Board      string `json:"board"`
	Mode       Mode   `json:"mode"`
	Status     string `json:"status"`
	Discovered int    `json:"discovered"`
	Hydrated   int    `json:"hydrated"`
	Failed     int    `json:"failed"`
	Pending    int    `json:"pending"`
	Resumed    bool   `json:"resumed"`
}

// PartialRunError makes incomplete durable work visible to shells and schedulers.
type PartialRunError struct {
	Result RunResult
}

func (errorValue PartialRunError) Error() string {
	return fmt.Sprintf(
		"%s %s refresh %d is partial: %d failed and %d pending",
		errorValue.Result.Board,
		errorValue.Result.Mode,
		errorValue.Result.RunID,
		errorValue.Result.Failed,
		errorValue.Result.Pending,
	)
}

// RunSummary is one persisted collector run for operator inspection.
type RunSummary struct {
	ID           int64    `json:"id"`
	Board        string   `json:"board"`
	Scope        string   `json:"scope"`
	Mode         Mode     `json:"mode"`
	Status       string   `json:"status"`
	Partitions   []string `json:"partitions"`
	Discovered   int      `json:"discovered"`
	Hydrated     int      `json:"hydrated"`
	Failed       int      `json:"failed"`
	StartedAt    string   `json:"started_at"`
	FinishedAt   string   `json:"finished_at"`
	ErrorDetail  string   `json:"error_detail"`
	SourceProven bool     `json:"source_complete"`
}

// ValidJobStatus reports whether a CLI status filter is supported.
func ValidJobStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "", "active", "stale", "closed", "ignored", "applied":
		return true
	default:
		return false
	}
}
