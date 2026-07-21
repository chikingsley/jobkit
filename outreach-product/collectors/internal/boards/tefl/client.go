package tefl

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehttp"
)

const (
	Board       = "tefl"
	landingPath = "/job-seeker/"
	detailPath  = "/job-seeker/jobpage.html"
)

var jobIDPattern = regexp.MustCompile(`jobpage\.html\?jobId=(\d+)`)

// Client collects TEFL.com's anonymous server-rendered inventory.
type Client struct {
	http *sourcehttp.Client
}

// NewClient constructs a TEFL.com source client.
func NewClient(baseURL string, httpClient sourcehttp.Doer, delay time.Duration) (*Client, error) {
	client, err := sourcehttp.New(baseURL, httpClient, delay)
	if err != nil {
		return nil, err
	}
	return &Client{http: client}, nil
}

func (client *Client) Board() string        { return Board }
func (client *Client) Scope() string        { return "all" }
func (client *Client) Partitions() []string { return nil }

// Discover follows pageNo until the source returns no new IDs. Latest mode
// reads only the first page and is never considered source-complete.
func (client *Client) Discover(ctx context.Context, mode inventory.Mode) (inventory.Discovery, error) {
	var items []inventory.Item
	seen := make(map[string]struct{})
	page := 1
	for {
		response, err := client.http.Get(ctx, listPath(page), "text/html")
		if err != nil {
			return inventory.Discovery{}, err
		}
		ids := uniqueMatches(jobIDPattern, string(response.Body))
		if page == 1 && len(ids) == 0 {
			return inventory.Discovery{}, fmt.Errorf("TEFL.com first listing page exposed no stable job IDs")
		}
		fresh := 0
		for _, id := range ids {
			if _, duplicate := seen[id]; duplicate {
				continue
			}
			seen[id] = struct{}{}
			items = append(items, inventory.Item{ID: id})
			fresh++
		}
		if mode == inventory.ModeLatest || fresh == 0 {
			break
		}
		page++
	}
	complete := mode == inventory.ModeFull
	evidence := map[string]string{
		"pages_checked": strconv.Itoa(page),
		"source_total":  strconv.Itoa(len(items)),
	}
	if complete {
		evidence["source_exhausted"] = "true"
	}
	return inventory.Discovery{Items: items, Complete: complete, Evidence: evidence}, nil
}

// Hydrate reads one JSON-LD-backed TEFL.com detail page.
func (client *Client) Hydrate(ctx context.Context, item inventory.Item) (inventory.Record, error) {
	path := detailURL(item.ID)
	response, err := client.http.Get(ctx, path, "text/html")
	if err != nil {
		return inventory.Record{}, err
	}
	record, err := ParseDetail(item.ID, response.URL, response.Body)
	if err != nil {
		return inventory.Record{}, fmt.Errorf("parse TEFL.com detail %s: %w", item.ID, err)
	}
	return record, nil
}

func listPath(page int) string {
	if page <= 1 {
		return landingPath
	}
	return landingPath + "?" + url.Values{"pageNo": []string{strconv.Itoa(page)}}.Encode()
}

func detailURL(jobID string) string {
	return detailPath + "?" + url.Values{"jobId": []string{jobID}}.Encode()
}

func uniqueMatches(pattern *regexp.Regexp, value string) []string {
	seen := make(map[string]struct{})
	var result []string
	for _, match := range pattern.FindAllStringSubmatch(value, -1) {
		if len(match) < 2 {
			continue
		}
		if _, duplicate := seen[match[1]]; duplicate {
			continue
		}
		seen[match[1]] = struct{}{}
		result = append(result, match[1])
	}
	return result
}
