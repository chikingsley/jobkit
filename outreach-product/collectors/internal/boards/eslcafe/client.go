package eslcafe

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehttp"
)

// HTTPDoer is the part of http.Client used by the collector.
type HTTPDoer = sourcehttp.Doer

// HTTPError is the shared source HTTP failure type.
type HTTPError = sourcehttp.HTTPError

// Client retrieves the public JSON inventory and server-rendered details
// through the shared paced source client.
type Client struct {
	http   *sourcehttp.Client
	boards []string
}

// NewClient constructs an ESL Cafe source client.
func NewClient(
	baseURL string,
	httpClient HTTPDoer,
	delay time.Duration,
	boards ...string,
) (*Client, error) {
	normalized, err := NormalizeBoards(boards)
	if err != nil {
		return nil, err
	}
	client, err := sourcehttp.New(baseURL, httpClient, delay)
	if err != nil {
		return nil, err
	}
	return &Client{
		http:   client,
		boards: normalized,
	}, nil
}

// Board returns the canonical inventory board identifier.
func (client *Client) Board() string { return InventoryBoard }

// Scope identifies the exact resumable board selection.
func (client *Client) Scope() string { return strings.Join(client.boards, ",") }

// Partitions identifies the source-board rows covered by a complete run.
func (client *Client) Partitions() []string { return append([]string(nil), client.boards...) }

// Discover enumerates the configured source boards. Full mode validates every
// page and reported total; latest mode reads one page per board and cannot
// reconcile absent jobs.
func (client *Client) Discover(ctx context.Context, mode inventory.Mode) (inventory.Discovery, error) {
	result := inventory.Discovery{
		Complete: mode == inventory.ModeFull,
		Evidence: map[string]string{"boards_checked": strconv.Itoa(len(client.boards))},
	}
	totalPages := 0
	sourceTotal := 0
	for _, board := range client.boards {
		items, pages, total, err := client.discoverBoard(ctx, board, mode)
		if err != nil {
			return inventory.Discovery{}, err
		}
		for _, summary := range items {
			result.Items = append(result.Items, summaryItem(summary))
		}
		totalPages += pages
		sourceTotal += total
	}
	result.Evidence["pages_checked"] = strconv.Itoa(totalPages)
	result.Evidence["source_total"] = strconv.Itoa(sourceTotal)
	return result, nil
}

func (client *Client) discoverBoard(
	ctx context.Context,
	board string,
	mode inventory.Mode,
) ([]Summary, int, int, error) {
	var result []Summary
	seen := make(map[string]struct{})
	reportedTotal := -1
	lastPage := 1
	for page := 1; page <= lastPage; page++ {
		response, err := client.listPage(ctx, board, page)
		if err != nil {
			return nil, 0, 0, err
		}
		if response.Paging.Page != page || response.Paging.LastPage < page || response.Paging.Total < 0 {
			return nil, 0, 0, fmt.Errorf(
				"ESL Cafe %s returned inconsistent pagination (page=%d last=%d total=%d)",
				board,
				response.Paging.Page,
				response.Paging.LastPage,
				response.Paging.Total,
			)
		}
		if reportedTotal < 0 {
			reportedTotal = response.Paging.Total
		} else if reportedTotal != response.Paging.Total {
			return nil, 0, 0, fmt.Errorf("ESL Cafe %s total changed during discovery", board)
		}
		lastPage = response.Paging.LastPage
		for _, item := range response.Data {
			item.Slug = strings.TrimSpace(item.Slug)
			if item.Slug == "" {
				return nil, 0, 0, fmt.Errorf("ESL Cafe %s returned a listing without a stable slug", board)
			}
			if _, duplicate := seen[item.Slug]; duplicate {
				continue
			}
			seen[item.Slug] = struct{}{}
			item.Board = board
			result = append(result, item)
		}
		if mode == inventory.ModeLatest {
			return result, 1, response.Paging.Total, nil
		}
	}
	if len(seen) != reportedTotal {
		return nil, 0, 0, fmt.Errorf(
			"ESL Cafe %s reported %d records but discovery found %d unique slugs",
			board,
			reportedTotal,
			len(seen),
		)
	}
	return result, lastPage, reportedTotal, nil
}

func (client *Client) listPage(ctx context.Context, board string, page int) (pageResponse, error) {
	values := url.Values{
		"jobBoardSlug": []string{board},
		"page":         []string{strconv.Itoa(page)},
		"size":         []string{strconv.Itoa(pageSize)},
		"name":         []string{""},
		"sortColumn":   []string{"SortOrder"},
		"sortType":     []string{"asc"},
		"jobType":      []string{strconv.Itoa(jobType)},
	}
	response, err := client.http.Get(ctx, listPath+"?"+values.Encode(), "application/json")
	if err != nil {
		return pageResponse{}, err
	}
	var parsedPage pageResponse
	if err := json.Unmarshal(response.Body, &parsedPage); err != nil {
		return pageResponse{}, fmt.Errorf("decode ESL Cafe %s page %d: %w", board, page, err)
	}
	return parsedPage, nil
}

// Hydrate retrieves and parses one posting detail page. Semantic extraction
// belongs to JobKit's shared evidence-backed processing stage, not the source
// collector.
func (client *Client) Hydrate(ctx context.Context, item inventory.Item) (inventory.Record, error) {
	summary := itemSummary(item)
	requestPath := detailPath + url.PathEscape(summary.Slug)
	response, err := client.http.Get(ctx, requestPath, "text/html")
	if err != nil {
		return inventory.Record{}, err
	}
	posting, err := ParseDetail(summary, response.URL, response.Body)
	if err != nil {
		return inventory.Record{}, fmt.Errorf("parse ESL Cafe detail %s: %w", summary.Slug, err)
	}
	return posting, nil
}

func summaryItem(summary Summary) inventory.Item {
	return inventory.Item{
		ID:          summary.Slug,
		SourceBoard: summary.Board,
		Metadata: map[string]string{
			"title":             summary.Title,
			"company":           summary.Company,
			"status_start_date": summary.StatusStartDate,
			"open_new_tab":      strconv.FormatBool(summary.OpenNewTab),
		},
	}
}

func itemSummary(item inventory.Item) Summary {
	openNewTab, _ := strconv.ParseBool(item.Metadata["open_new_tab"])
	return Summary{
		Board:           item.SourceBoard,
		Slug:            item.ID,
		Title:           item.Metadata["title"],
		Company:         item.Metadata["company"],
		StatusStartDate: item.Metadata["status_start_date"],
		OpenNewTab:      openNewTab,
	}
}
