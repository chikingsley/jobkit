package seriousteachers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehtml"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehttp"
)

const (
	Board         = "seriousteachers"
	loginPath     = "/te2/login"
	latestDefault = 15
	pageSize      = 20
)

var (
	jobIDPattern    = regexp.MustCompile(`/job_details/(\d+)`)
	applyPattern    = regexp.MustCompile(`(?i)/te2/login/(\d+)/(\d+)`)
	defaultSubjects = []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14}
)

// Credentials are an optional teacher account used only to resolve gated
// application routes. Public inventory collection does not require them.
type Credentials struct {
	Email    string
	Password string
}

// Client collects the public country-by-subject inventory and optionally
// resolves authenticated application routes with a reused cookie session.
type Client struct {
	http           *sourcehttp.Client
	credentials    Credentials
	subjectIDs     []int
	latestLimit    int
	loginMu        sync.Mutex
	loginAttempted bool
	loggedIn       bool
}

// NewClient constructs a SeriousTeachers source client.
func NewClient(
	baseURL string,
	httpClient sourcehttp.Doer,
	delay time.Duration,
	credentials Credentials,
) (*Client, error) {
	client, err := sourcehttp.New(baseURL, httpClient, delay)
	if err != nil {
		return nil, err
	}
	return &Client{
		http:        client,
		credentials: credentials,
		subjectIDs:  append([]int(nil), defaultSubjects...),
		latestLimit: latestDefault,
	}, nil
}

func (client *Client) Board() string        { return Board }
func (client *Client) Scope() string        { return "all" }
func (client *Client) Partitions() []string { return nil }

// Discover samples newest/featured jobs or exhausts the finite
// country-by-subject matrix exposed by the source.
func (client *Client) Discover(ctx context.Context, mode inventory.Mode) (inventory.Discovery, error) {
	home, err := client.http.Get(ctx, countryListPath(), "text/html")
	if err != nil {
		return inventory.Discovery{}, err
	}
	countries, err := countryOptions(home.Body)
	if err != nil {
		return inventory.Discovery{}, err
	}
	if len(countries) == 0 {
		return inventory.Discovery{}, fmt.Errorf("SeriousTeachers listing page exposed no Jobs by Country inventory")
	}
	items := make([]inventory.Item, 0)
	seen := make(map[string]int)
	appendItems(&items, seen, jobIDs(home.Body), nil)
	pagesChecked := 1
	if mode == inventory.ModeLatest {
		for _, subjectID := range client.subjectIDs {
			if len(items) >= client.latestLimit {
				break
			}
			response, err := client.optionalGet(ctx, listPath(0, subjectID))
			if err != nil {
				return inventory.Discovery{}, err
			}
			pagesChecked++
			appendItems(&items, seen, jobIDs(response), map[string]string{
				"subject_id": strconv.Itoa(subjectID),
			})
		}
		if len(items) > client.latestLimit {
			items = items[:client.latestLimit]
		}
		return inventory.Discovery{
			Items:    items,
			Complete: false,
			Evidence: map[string]string{
				"countries_exposed": strconv.Itoa(len(countries)),
				"pages_checked":     strconv.Itoa(pagesChecked),
				"sample":            strconv.Itoa(len(items)),
			},
		}, nil
	}

	// A country page returns at most pageSize listings. Only a country that
	// fills the page can be hiding more, so the subject matrix is walked for
	// those alone. Walking all fourteen subjects for all countries is roughly
	// 2,900 requests, which Cloudflare escalates against partway through.
	for _, country := range countries {
		response, err := client.optionalGet(ctx, listPath(country.ID, 0))
		if err != nil {
			return inventory.Discovery{}, err
		}
		pagesChecked++
		found := jobIDs(response)
		appendItems(&items, seen, found, country.metadata(0))
		if len(found) < pageSize {
			continue
		}
		for _, subjectID := range client.subjectIDs {
			response, err := client.optionalGet(ctx, listPath(country.ID, subjectID))
			if err != nil {
				return inventory.Discovery{}, err
			}
			pagesChecked++
			appendItems(&items, seen, jobIDs(response), country.metadata(subjectID))
		}
	}
	if len(items) == 0 {
		return inventory.Discovery{}, fmt.Errorf("SeriousTeachers full discovery found no listing IDs")
	}
	return inventory.Discovery{
		Items:    items,
		Complete: true,
		Evidence: map[string]string{
			"countries_checked": strconv.Itoa(len(countries)),
			"pages_checked":     strconv.Itoa(pagesChecked),
			"source_total":      strconv.Itoa(len(items)),
		},
	}, nil
}

// Hydrate reads one public detail and resolves its gated apply route only when
// an optional authenticated teacher session succeeds.
func (client *Client) Hydrate(ctx context.Context, item inventory.Item) (inventory.Record, error) {
	path := detailPath(item.ID)
	response, err := client.http.Get(ctx, path, "text/html")
	if err != nil {
		return inventory.Record{}, err
	}
	record, err := ParseDetail(item.ID, response.URL, response.Body)
	if err != nil {
		return inventory.Record{}, fmt.Errorf("parse SeriousTeachers detail %s: %w", item.ID, err)
	}
	if country := strings.TrimSpace(item.Metadata["country"]); country != "" {
		record.Country = country
		record.Fields["source_country"] = country
	}
	if applyPattern.MatchString(record.ApplyURL) && client.hasCredentials() {
		if loginErr := client.login(ctx); loginErr == nil {
			if resolved, resolveErr := client.resolveApply(ctx, record.ApplyURL); resolveErr == nil {
				record.ApplyURL = resolved
			}
		}
	}
	return record, nil
}

func (client *Client) optionalGet(ctx context.Context, path string) ([]byte, error) {
	response, err := client.http.Get(ctx, path, "text/html")
	if err == nil {
		return response.Body, nil
	}
	var httpError sourcehttp.HTTPError
	if errors.As(err, &httpError) &&
		(httpError.StatusCode == http.StatusNotFound || httpError.StatusCode == http.StatusGone) {
		return nil, nil
	}
	return nil, err
}

func (client *Client) hasCredentials() bool {
	return strings.TrimSpace(client.credentials.Email) != "" && client.credentials.Password != ""
}

func (client *Client) login(ctx context.Context) error {
	client.loginMu.Lock()
	defer client.loginMu.Unlock()
	if client.loggedIn {
		return nil
	}
	if client.loginAttempted {
		return fmt.Errorf("SeriousTeachers login was not accepted")
	}
	client.loginAttempted = true
	response, err := client.http.Get(ctx, loginPath, "text/html")
	if err != nil {
		return err
	}
	document, err := sourcehtml.Parse(response.Body)
	if err != nil {
		return err
	}
	token := sourcehtml.Attr(document.Find(`input[name="__RequestVerificationToken"]`).First(), "value")
	if token == "" {
		return fmt.Errorf("SeriousTeachers login page exposed no request-verification token")
	}
	values := url.Values{
		"email":                      []string{client.credentials.Email},
		"password":                   []string{client.credentials.Password},
		"idjob":                      []string{"0"},
		"idemployer":                 []string{"0"},
		"__RequestVerificationToken": []string{token},
	}
	loginResponse, err := client.http.PostForm(ctx, loginPath, values)
	if err != nil {
		return err
	}
	if strings.Contains(strings.ToLower(loginResponse.URL), "/te2/login") {
		return fmt.Errorf("SeriousTeachers login returned to the login page")
	}
	client.loggedIn = true
	return nil
}

func (client *Client) resolveApply(ctx context.Context, applyURL string) (string, error) {
	response, err := client.http.Get(ctx, applyURL, "text/html")
	if err != nil {
		return "", err
	}
	if strings.Contains(strings.ToLower(response.URL), "/te2/login") {
		return "", fmt.Errorf("SeriousTeachers apply route returned to login")
	}
	return response.URL, nil
}

type countryOption struct {
	ID   int
	Name string
}

func (country countryOption) metadata(subjectID int) map[string]string {
	metadata := map[string]string{
		"country_id": strconv.Itoa(country.ID),
		"country":    country.Name,
	}
	if subjectID > 0 {
		metadata["subject_id"] = strconv.Itoa(subjectID)
	}
	return metadata
}

func countryOptions(body []byte) ([]countryOption, error) {
	document, err := sourcehtml.Parse(body)
	if err != nil {
		return nil, err
	}
	seen := make(map[int]struct{})
	var countries []countryOption
	document.Find("option[value]").Each(func(_ int, selection *goquery.Selection) {
		value := sourcehtml.Attr(selection, "value")
		id, conversionErr := strconv.Atoi(value)
		name := sourcehtml.Clean(selection.Text())
		if conversionErr != nil || id <= 0 || strings.Contains(strings.ToLower(name), "list all") {
			return
		}
		if _, duplicate := seen[id]; duplicate {
			return
		}
		seen[id] = struct{}{}
		countries = append(countries, countryOption{ID: id, Name: name})
	})
	return countries, nil
}

func appendItems(
	items *[]inventory.Item,
	seen map[string]int,
	ids []string,
	metadata map[string]string,
) {
	for _, id := range ids {
		if index, duplicate := seen[id]; duplicate {
			for key, value := range metadata {
				if (*items)[index].Metadata[key] == "" {
					(*items)[index].Metadata[key] = value
				}
			}
			continue
		}
		copyMetadata := make(map[string]string, len(metadata))
		for key, value := range metadata {
			copyMetadata[key] = value
		}
		seen[id] = len(*items)
		*items = append(*items, inventory.Item{ID: id, Metadata: copyMetadata})
	}
}

func jobIDs(body []byte) []string {
	seen := make(map[string]struct{})
	var result []string
	for _, match := range jobIDPattern.FindAllSubmatch(body, -1) {
		id := string(match[1])
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

// The legacy /0/{country}/{subject} route truncates a country's listings; the
// /jobs/ route returns them all. Brazil serves ten on the legacy route and
// twenty here, and its country dropdown carries 192 countries against the
// homepage's 43.
func listPath(countryID, subjectID int) string {
	if subjectID > 0 {
		return fmt.Sprintf("/jobs/%d/%d/all", subjectID, countryID)
	}
	return fmt.Sprintf("/jobs/0/%d/all", countryID)
}

func countryListPath() string {
	return "/jobs/0/0/all"
}

func detailPath(jobID string) string {
	return "/job_details/" + url.PathEscape(jobID) + "/0/"
}

// Outcome reports what happened when an application was submitted.
type Outcome struct {
	Detail string
	Status string
	URL    string
}

// Respond submits one application to a job, reusing the authenticated session
// and Cloudflare clearance the crawler already holds.
func (client *Client) Respond(ctx context.Context, jobID, employerID, comments string) (Outcome, error) {
	if !client.hasCredentials() {
		return Outcome{}, fmt.Errorf("SeriousTeachers credentials are required to apply")
	}
	if strings.TrimSpace(comments) == "" {
		return Outcome{}, fmt.Errorf("an application needs a message")
	}
	if err := client.login(ctx); err != nil {
		return Outcome{}, err
	}
	respondPath := fmt.Sprintf("/te2/respond/%s/%s", jobID, employerID)
	response, err := client.http.Get(ctx, respondPath, "text/html")
	if err != nil {
		return Outcome{}, err
	}
	if strings.Contains(strings.ToLower(response.URL), "/te2/login") {
		return Outcome{}, fmt.Errorf("SeriousTeachers apply page returned to login")
	}
	document, err := sourcehtml.Parse(response.Body)
	if err != nil {
		return Outcome{}, err
	}
	if document.Find(`textarea[name="Comments"]`).Length() == 0 {
		body := strings.ToLower(document.Text())
		if strings.Contains(body, "already applied") || strings.Contains(body, "already responded") {
			return Outcome{Status: "already-applied"}, nil
		}
		return Outcome{}, fmt.Errorf("SeriousTeachers apply page exposed no comments field")
	}
	token := sourcehtml.Attr(document.Find(`input[name="__RequestVerificationToken"]`).First(), "value")
	if token == "" {
		return Outcome{}, fmt.Errorf("SeriousTeachers apply page exposed no request-verification token")
	}
	locatedIn := sourcehtml.Attr(document.Find(`select[name="locatedin"] option[selected]`).First(), "value")
	if locatedIn == "" {
		locatedIn = "United States of America"
	}
	values := url.Values{
		"Comments":                   []string{comments},
		"Teacher.Abroad":             []string{""},
		"Teacher.euteacher":          []string{"1"},
		"__RequestVerificationToken": []string{token},
		"locatedin":                  []string{locatedIn},
	}
	sent, err := client.http.PostForm(ctx, respondPath, values)
	if err != nil {
		return Outcome{}, err
	}
	confirmed, err := sourcehtml.Parse(sent.Body)
	if err != nil {
		return Outcome{}, err
	}
	body := strings.ToLower(confirmed.Text())
	switch {
	case strings.Contains(body, "application submitted successfully"):
		return Outcome{Status: "submitted", URL: sent.URL}, nil
	case strings.Contains(body, "already applied"), strings.Contains(body, "already responded"):
		return Outcome{Status: "already-applied", URL: sent.URL}, nil
	default:
		return Outcome{Detail: "no confirmation banner", Status: "failed", URL: sent.URL}, nil
	}
}
