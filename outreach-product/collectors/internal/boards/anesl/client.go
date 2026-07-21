package anesl

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
	"golang.org/x/net/html"
)

const (
	Board         = "anesl"
	listPath      = "/joblist.aspx"
	detailPath    = "/jobdetail.aspx"
	pagerTarget   = "ctl00$ContentPlaceHolder1$AspNetPager1"
	pageSizeField = "ctl00$ContentPlaceHolder1$dppagesize"
	pageSize      = 100
)

var (
	jobIDPattern  = regexp.MustCompile(`(?i)jobdetail\.aspx\?id=(\d+)`)
	totalsPattern = regexp.MustCompile(
		`(?is)Total\s*Records:\s*<b>\s*(\d+)\s*</b>.*?Pages:\s*<b>\s*(\d+)\s*</b>.*?Current\s*Page:\s*<b>\s*(\d+)\s*</b>`,
	)
)

// Client collects ANESL's ASP.NET WebForms inventory.
type Client struct {
	http *sourcehttp.Client
}

// NewClient constructs an ANESL source client. The supplied HTTP client should
// have a cookie jar so WebForms postbacks keep the source session.
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

// Discover reads either the first list page or the complete source-reported
// WebForms pager.
func (client *Client) Discover(ctx context.Context, mode inventory.Mode) (inventory.Discovery, error) {
	response, err := client.http.Get(ctx, listPath, "text/html")
	if err != nil {
		return inventory.Discovery{}, err
	}
	if mode == inventory.ModeLatest {
		candidates, err := listingCandidates(response.Body)
		if err != nil {
			return inventory.Discovery{}, err
		}
		items, routeCollisions, err := finalizeListingItems(candidates)
		if err != nil {
			return inventory.Discovery{}, err
		}
		total, _, _, err := pageTotals(response.Body)
		if err != nil {
			return inventory.Discovery{}, err
		}
		if total > 0 && len(items) == 0 {
			return inventory.Discovery{}, fmt.Errorf("ANESL latest page exposed no listing IDs")
		}
		return inventory.Discovery{
			Items:    items,
			Complete: false,
			Evidence: map[string]string{
				"detail_route_collisions": strconv.Itoa(routeCollisions),
				"pages_checked":           "1",
				"source_total":            strconv.Itoa(total),
			},
		}, nil
	}

	fields, err := hiddenFields(response.Body)
	if err != nil {
		return inventory.Discovery{}, err
	}
	fields.Set("__EVENTTARGET", pageSizeField)
	fields.Set("__EVENTARGUMENT", "")
	fields.Set(pageSizeField, strconv.Itoa(pageSize))
	response, err = client.http.PostForm(ctx, listPath, fields)
	if err != nil {
		return inventory.Discovery{}, err
	}
	var candidates []listingCandidate
	var pageListingCounts []int
	totalRecords, totalPages, currentPage, err := pageTotals(response.Body)
	if err != nil {
		return inventory.Discovery{}, err
	}
	if currentPage != 1 {
		return inventory.Discovery{}, fmt.Errorf("ANESL pager returned page %d while page 1 was requested", currentPage)
	}
	for page := 1; page <= totalPages; page++ {
		if page > 1 {
			fields, err = hiddenFields(response.Body)
			if err != nil {
				return inventory.Discovery{}, err
			}
			fields.Set(pageSizeField, strconv.Itoa(pageSize))
			fields.Set("__EVENTTARGET", pagerTarget)
			fields.Set("__EVENTARGUMENT", strconv.Itoa(page))
			response, err = client.http.PostForm(ctx, listPath, fields)
			if err != nil {
				return inventory.Discovery{}, err
			}
			pageRecords, pageCount, returnedPage, err := pageTotals(response.Body)
			if err != nil {
				return inventory.Discovery{}, err
			}
			if pageRecords != totalRecords || pageCount != totalPages {
				return inventory.Discovery{}, fmt.Errorf("ANESL pager totals changed during discovery")
			}
			if returnedPage != page {
				return inventory.Discovery{}, fmt.Errorf(
					"ANESL pager returned page %d while page %d was requested",
					returnedPage,
					page,
				)
			}
		}
		pageCandidates, err := listingCandidates(response.Body)
		if err != nil {
			return inventory.Discovery{}, fmt.Errorf("parse ANESL page %d: %w", page, err)
		}
		pageListingCounts = append(pageListingCounts, len(pageCandidates))
		if totalRecords > 0 && len(pageCandidates) == 0 {
			return inventory.Discovery{}, fmt.Errorf("ANESL page %d exposed no listing IDs", page)
		}
		candidates = append(candidates, pageCandidates...)
	}
	items, routeCollisions, err := finalizeListingItems(candidates)
	if err != nil {
		return inventory.Discovery{}, err
	}
	if len(items) != totalRecords {
		return inventory.Discovery{}, fmt.Errorf(
			"ANESL reported %d records but discovery found %d offer identities; page listing counts %v",
			totalRecords,
			len(items),
			pageListingCounts,
		)
	}
	return inventory.Discovery{
		Items:    items,
		Complete: true,
		Evidence: map[string]string{
			"detail_route_collisions": strconv.Itoa(routeCollisions),
			"pages_checked":           strconv.Itoa(totalPages),
			"source_pages":            strconv.Itoa(totalPages),
			"source_total":            strconv.Itoa(totalRecords),
		},
	}, nil
}

// Hydrate reads one label/value detail page.
func (client *Client) Hydrate(ctx context.Context, item inventory.Item) (inventory.Record, error) {
	detailID := item.Metadata["detail_id"]
	if detailID == "" {
		detailID = item.ID
	}
	path := detailPath + "?" + url.Values{"id": []string{detailID}}.Encode()
	response, err := client.http.Get(ctx, path, "text/html")
	if err != nil {
		return inventory.Record{}, err
	}
	record, err := ParseDetail(item.ID, response.URL, response.Body)
	if err != nil {
		return inventory.Record{}, fmt.Errorf("parse ANESL detail %s: %w", item.ID, err)
	}
	record.Fields["Detail ID"] = detailID
	if offerID := item.Metadata["offer_id"]; offerID != "" {
		if detailOfferID := record.Fields["Position ID"]; detailOfferID != "" && detailOfferID != offerID {
			record.Fields["Detail Position ID"] = detailOfferID
		}
		record.Fields["Position ID"] = offerID
	}
	if listingTitle := item.Metadata["listing_title"]; listingTitle != "" {
		record.Title = listingTitle
	}
	if listingSalary := item.Metadata["listing_salary"]; listingSalary != "" {
		record.Salary = listingSalary
		record.Fields["Listing Salary"] = listingSalary
	}
	if listingSummary := item.Metadata["listing_summary"]; listingSummary != "" {
		record.Fields["Listing Summary"] = listingSummary
	}
	return record, nil
}

type listingCandidate struct {
	DetailID string
	OfferID  string
	Salary   string
	Summary  string
	Title    string
}

func listingCandidates(body []byte) ([]listingCandidate, error) {
	document, err := sourcehtml.Parse(body)
	if err != nil {
		return nil, err
	}
	var candidates []listingCandidate
	seenListings := make(map[*html.Node]struct{})
	document.Find("a[href]").Each(func(_ int, selection *goquery.Selection) {
		match := jobIDPattern.FindStringSubmatch(sourcehtml.Attr(selection, "href"))
		if len(match) != 2 {
			return
		}
		listing := selection.ParentsFiltered(`table[cellspacing="1"]`).First()
		if listing.Length() == 0 {
			return
		}
		listingKey := listing.Get(0)
		if _, seen := seenListings[listingKey]; seen {
			return
		}
		seenListings[listingKey] = struct{}{}
		offerID := sourcehtml.Clean(selection.Text())
		title := ""
		listing.Find("a[href]").EachWithBreak(func(_ int, link *goquery.Selection) bool {
			linkMatch := jobIDPattern.FindStringSubmatch(sourcehtml.Attr(link, "href"))
			text := sourcehtml.Clean(link.Text())
			if len(linkMatch) == 2 && text != "" && text != offerID {
				title = text
				return false
			}
			return true
		})
		salary := ""
		listing.Find("td").EachWithBreak(func(_ int, cell *goquery.Selection) bool {
			text := sourcehtml.Clean(cell.Text())
			if strings.HasPrefix(text, "Salary:") {
				salary = strings.TrimSpace(strings.TrimPrefix(text, "Salary:"))
				return false
			}
			return true
		})
		candidates = append(candidates, listingCandidate{
			DetailID: match[1],
			OfferID:  offerID,
			Salary:   salary,
			Summary:  sourcehtml.Clean(listing.Text()),
			Title:    title,
		})
	})
	return candidates, nil
}

func finalizeListingItems(candidates []listingCandidate) ([]inventory.Item, int, error) {
	detailCounts := make(map[string]int)
	for _, candidate := range candidates {
		detailCounts[candidate.DetailID]++
	}
	items := make([]inventory.Item, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	routeCollisions := 0
	for _, candidate := range candidates {
		id := candidate.DetailID
		if detailCounts[candidate.DetailID] > 1 {
			id = candidate.DetailID + ":" + strings.ToLower(candidate.OfferID)
			routeCollisions++
		}
		if _, duplicate := seen[id]; duplicate {
			return nil, 0, fmt.Errorf("ANESL exposed duplicate offer identity %s", id)
		}
		seen[id] = struct{}{}
		items = append(items, inventory.Item{
			ID: id,
			Metadata: map[string]string{
				"detail_id":       candidate.DetailID,
				"listing_salary":  candidate.Salary,
				"listing_summary": candidate.Summary,
				"listing_title":   candidate.Title,
				"offer_id":        candidate.OfferID,
			},
		})
	}
	return items, routeCollisions, nil
}

func hiddenFields(body []byte) (url.Values, error) {
	document, err := sourcehtml.Parse(body)
	if err != nil {
		return nil, err
	}
	fields := url.Values{}
	document.Find(`input[type="hidden"][name]`).Each(func(_ int, selection *goquery.Selection) {
		name := sourcehtml.Attr(selection, "name")
		if name != "" {
			fields.Set(name, sourcehtml.Attr(selection, "value"))
		}
	})
	if fields.Get("__VIEWSTATE") == "" {
		return nil, fmt.Errorf("ANESL list page exposed no __VIEWSTATE")
	}
	return fields, nil
}

func pageTotals(body []byte) (int, int, int, error) {
	match := totalsPattern.FindSubmatch(body)
	if len(match) != 4 {
		return 0, 0, 0, fmt.Errorf("ANESL page did not expose record/page totals")
	}
	values := make([]int, 3)
	for index := range values {
		value, err := strconv.Atoi(strings.TrimSpace(string(match[index+1])))
		if err != nil {
			return 0, 0, 0, err
		}
		values[index] = value
	}
	return values[0], values[1], values[2], nil
}
