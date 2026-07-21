package eslcafe

import (
	"fmt"
	"sort"
	"strings"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
)

const (
	listPath   = "/api/list/PostAJobList"
	detailPath = "/postajob-detail/"
	pageSize   = 60
	jobType    = 1

	// InventoryBoard is the canonical JobKit board identifier.
	InventoryBoard = "eslcafe-modern"
)

var supportedBoards = map[string]struct{}{
	"china":         {},
	"international": {},
	"korea":         {},
}

// Summary is stable listing metadata returned by the ESL Cafe JSON API.
type Summary struct {
	Board           string `json:"board"`
	Slug            string `json:"slug"`
	Title           string `json:"jobTitle"`
	Company         string `json:"company"`
	StatusStartDate string `json:"statusStartDate"`
	OpenNewTab      bool   `json:"isOpenNewTab"`
}

type pageResponse struct {
	Paging pageMetadata `json:"paging"`
	Data   []Summary    `json:"data"`
}

type pageMetadata struct {
	Page     int `json:"page"`
	LastPage int `json:"lastPage"`
	Size     int `json:"size"`
	Total    int `json:"total"`
}

// Posting is retained as a source-package name for parser readability.
type Posting = inventory.Record

// NormalizeBoards validates, deduplicates, and sorts a board set. Empty input
// means all public ESL Cafe boards.
func NormalizeBoards(boards []string) ([]string, error) {
	if len(boards) == 0 {
		boards = []string{"china", "international", "korea"}
	}
	unique := make(map[string]struct{}, len(boards))
	for _, board := range boards {
		board = strings.ToLower(strings.TrimSpace(board))
		if _, ok := supportedBoards[board]; !ok {
			return nil, fmt.Errorf(
				"unsupported ESL Cafe board %q; expected china, international, or korea",
				board,
			)
		}
		unique[board] = struct{}{}
	}
	result := make([]string, 0, len(unique))
	for board := range unique {
		result = append(result, board)
	}
	sort.Strings(result)
	return result, nil
}
