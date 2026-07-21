package ajarn

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehtml"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehttp"
)

const (
	Board    = "ajarn"
	listPath = "/recruitment/jobs"
)

var jobPattern = regexp.MustCompile(`/recruitment/jobs/(\d+)/([^/?#]*)`)

// Client collects Ajarn's public Thailand teaching inventory.
type Client struct {
	http *sourcehttp.Client
}

// NewClient constructs an Ajarn source client.
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

// Discover enumerates the single live list. Full mode makes one explicit
// repeated-page request and proves that it adds no new identities.
func (client *Client) Discover(ctx context.Context, mode inventory.Mode) (inventory.Discovery, error) {
	first, err := client.list(ctx, 1)
	if err != nil {
		return inventory.Discovery{}, err
	}
	if len(first) == 0 {
		return inventory.Discovery{}, fmt.Errorf("ajarn first listing page exposed no stable job IDs")
	}
	items := first
	pagesChecked := 1
	complete := false
	if mode == inventory.ModeFull {
		second, err := client.list(ctx, 2)
		if err != nil {
			return inventory.Discovery{}, err
		}
		pagesChecked++
		seen := itemIDs(first)
		for _, item := range second {
			if _, exists := seen[item.ID]; exists {
				continue
			}
			return inventory.Discovery{}, fmt.Errorf(
				"ajarn page 2 exposed new job %s; source contract requires pagination review",
				item.ID,
			)
		}
		complete = true
	}
	evidence := map[string]string{
		"pages_checked": strconv.Itoa(pagesChecked),
		"source_total":  strconv.Itoa(len(items)),
	}
	if complete {
		evidence["source_exhausted"] = "true"
	}
	return inventory.Discovery{Items: items, Complete: complete, Evidence: evidence}, nil
}

// Hydrate reads one Ajarn detail page without inferring facts from prose.
func (client *Client) Hydrate(ctx context.Context, item inventory.Item) (inventory.Record, error) {
	slug := item.Metadata["slug"]
	path := detailPath(item.ID, slug)
	response, err := client.http.Get(ctx, path, "text/html")
	if err != nil {
		return inventory.Record{}, err
	}
	record, err := ParseDetail(item.ID, slug, response.URL, response.Body)
	if err != nil {
		return inventory.Record{}, fmt.Errorf("parse Ajarn detail %s: %w", item.ID, err)
	}
	return record, nil
}

func (client *Client) list(ctx context.Context, page int) ([]inventory.Item, error) {
	path := listPath
	if page > 1 {
		path += "?" + url.Values{"page": []string{strconv.Itoa(page)}}.Encode()
	}
	response, err := client.http.Get(ctx, path, "text/html")
	if err != nil {
		return nil, err
	}
	document, err := sourcehtml.Parse(response.Body)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{})
	var items []inventory.Item
	document.Find(`a[href*="/recruitment/jobs/"]`).Each(func(_ int, selection *goquery.Selection) {
		href := sourcehtml.Attr(selection, "href")
		match := jobPattern.FindStringSubmatch(href)
		if len(match) != 3 {
			return
		}
		if _, duplicate := seen[match[1]]; duplicate {
			return
		}
		seen[match[1]] = struct{}{}
		items = append(items, inventory.Item{
			ID:       match[1],
			Metadata: map[string]string{"slug": strings.TrimSpace(match[2])},
		})
	})
	return items, nil
}

func itemIDs(items []inventory.Item) map[string]struct{} {
	result := make(map[string]struct{}, len(items))
	for _, item := range items {
		result[item.ID] = struct{}{}
	}
	return result
}

func detailPath(jobID, slug string) string {
	return listPath + "/" + url.PathEscape(jobID) + "/" + url.PathEscape(slug)
}
