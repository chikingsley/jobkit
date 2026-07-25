package teacherhorizons

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehttp"
)

const (
	Board          = "teacherhorizons"
	searchPath     = "/th/api/v1/jobs/search/school-area/full"
	countPath      = "/th/api/v1/jobs/search/school-area/full/count"
	listsPath      = "/th/api/v1/lists?key=regions,countries,cities,roles,subjects"
	pageLimit      = 20
	latestDefault  = 20
	maxDrawsPerRun = 240
	dryDrawsToStop = 25
)

// Credentials are accepted for parity with the other boards. The jobs API is
// public, so collection does not use them.
type Credentials struct {
	Email    string
	Password string
}

type Client struct {
	http        *sourcehttp.Client
	credentials Credentials
	lists       lookupTables
	listsOnce   sync.Once
	cacheMu     sync.Mutex
	cache       map[string]apiJob
}

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
		cache:       map[string]apiJob{},
	}, nil
}

func (client *Client) Board() string        { return Board }
func (client *Client) Scope() string        { return "all" }
func (client *Client) Partitions() []string { return nil }

type apiRegion struct {
	Name string `json:"name"`
	ID   int    `json:"id"`
}

type apiCountry struct {
	Name   string    `json:"name"`
	ID     int       `json:"id"`
	Region apiRegion `json:"region"`
}

type apiCity struct {
	Name    string     `json:"name"`
	ID      int        `json:"id"`
	Country apiCountry `json:"country"`
}

type apiJob struct {
	ID              int     `json:"id"`
	Title           string  `json:"title"`
	City            apiCity `json:"city"`
	RoleID          int     `json:"roleId"`
	SubjectID       int     `json:"subjectId"`
	JobTypeID       int     `json:"jobTypeId"`
	IsRemote        int     `json:"isRemote"`
	IsBoosted       int     `json:"isBoosted"`
	StartDate       string  `json:"startDate"`
	Deadline        int64   `json:"deadline"`
	LastUpdatedDate int64   `json:"lastUpdatedDate"`
	FurtherInfo     string  `json:"furtherInfo"`
}

type searchResponse struct {
	Jobs []apiJob `json:"jobs"`
}

type countResponse struct {
	Count int `json:"count"`
}

type namedEntry struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type lookupTables struct {
	Roles    []namedEntry `json:"roles"`
	Subjects []namedEntry `json:"subjects"`
}

func (tables lookupTables) role(id int) string    { return lookupName(tables.Roles, id) }
func (tables lookupTables) subject(id int) string { return lookupName(tables.Subjects, id) }

func lookupName(entries []namedEntry, id int) string {
	for _, entry := range entries {
		if entry.ID == id {
			return entry.Name
		}
	}
	return ""
}

// Discover samples the search endpoint repeatedly. The API caps every response
// at twenty jobs and honours no offset or cursor, so full collection draws with
// sort=random until several consecutive draws surface nothing new, bounded by
// the count endpoint.
func (client *Client) Discover(ctx context.Context, mode inventory.Mode) (inventory.Discovery, error) {
	client.loadLists(ctx)
	total, err := client.total(ctx)
	if err != nil {
		return inventory.Discovery{}, err
	}
	items := make([]inventory.Item, 0, total)
	seen := map[string]struct{}{}
	draws := 0

	appendDraw := func(query string) error {
		jobs, drawErr := client.search(ctx, query)
		if drawErr != nil {
			return drawErr
		}
		draws++
		added := 0
		for _, job := range jobs {
			id := strconv.Itoa(job.ID)
			if _, known := seen[id]; known {
				continue
			}
			seen[id] = struct{}{}
			client.remember(id, job)
			items = append(items, inventory.Item{
				ID:          id,
				SourceBoard: Board,
				Metadata:    job.metadata(),
			})
			added++
		}
		return nil
	}

	if err := appendDraw(fmt.Sprintf("?limit=%d", pageLimit)); err != nil {
		return inventory.Discovery{}, err
	}
	if mode == inventory.ModeLatest {
		return inventory.Discovery{
			Items:    items,
			Complete: false,
			Evidence: map[string]string{
				"draws":        strconv.Itoa(draws),
				"sample":       strconv.Itoa(len(items)),
				"source_total": strconv.Itoa(total),
			},
		}, nil
	}

	if err := appendDraw(fmt.Sprintf("?limit=%d&is-boosted=1", pageLimit)); err != nil {
		return inventory.Discovery{}, err
	}
	dry := 0
	for len(items) < total && draws < maxDrawsPerRun && dry < dryDrawsToStop {
		before := len(items)
		if err := appendDraw(fmt.Sprintf("?limit=%d&sort=random", pageLimit)); err != nil {
			return inventory.Discovery{}, err
		}
		if len(items) == before {
			dry++
			continue
		}
		dry = 0
	}
	if len(items) == 0 {
		return inventory.Discovery{}, fmt.Errorf("TeacherHorizons search returned no jobs")
	}
	return inventory.Discovery{
		Items:    items,
		Complete: len(items) >= total,
		Evidence: map[string]string{
			"draws":        strconv.Itoa(draws),
			"source_total": strconv.Itoa(total),
			"collected":    strconv.Itoa(len(items)),
		},
	}, nil
}

// Hydrate returns the record built from the job the search already delivered.
// The search response carries every field the detail view shows, so no second
// request is made.
func (client *Client) Hydrate(_ context.Context, item inventory.Item) (inventory.Record, error) {
	client.cacheMu.Lock()
	job, known := client.cache[item.ID]
	client.cacheMu.Unlock()
	if !known {
		return inventory.Record{}, fmt.Errorf("TeacherHorizons job %s was not captured during discovery", item.ID)
	}
	return client.record(job), nil
}

func (client *Client) record(job apiJob) inventory.Record {
	fields := job.metadata()
	if role := client.lists.role(job.RoleID); role != "" {
		fields["role"] = role
	}
	if subject := client.lists.subject(job.SubjectID); subject != "" {
		fields["subject"] = subject
	}
	location := strings.TrimSpace(job.City.Name)
	country := strings.TrimSpace(job.City.Country.Name)
	if job.IsRemote == 1 {
		location = strings.TrimSpace(location + " (remote)")
	}
	return inventory.Record{
		Board:       Board,
		JobID:       strconv.Itoa(job.ID),
		URL:         jobURL(job.ID),
		Title:       strings.TrimSpace(job.Title),
		Location:    location,
		Country:     country,
		StartDate:   job.StartDate,
		ApplyURL:    jobURL(job.ID),
		PostedDate:  epochDate(job.LastUpdatedDate),
		Description: strings.TrimSpace(job.FurtherInfo),
		Raw:         strings.TrimSpace(job.FurtherInfo),
		Fields:      fields,
	}
}

func (job apiJob) metadata() map[string]string {
	metadata := map[string]string{
		"city":       job.City.Name,
		"country":    job.City.Country.Name,
		"region":     job.City.Country.Region.Name,
		"role_id":    strconv.Itoa(job.RoleID),
		"subject_id": strconv.Itoa(job.SubjectID),
	}
	if job.IsRemote == 1 {
		metadata["remote"] = "true"
	}
	if job.IsBoosted == 1 {
		metadata["boosted"] = "true"
	}
	if job.StartDate != "" {
		metadata["start_date"] = job.StartDate
	}
	if closing := epochDate(job.Deadline); closing != "" {
		metadata["closing"] = closing
	}
	return metadata
}

func (client *Client) remember(id string, job apiJob) {
	client.cacheMu.Lock()
	client.cache[id] = job
	client.cacheMu.Unlock()
}

func (client *Client) search(ctx context.Context, query string) ([]apiJob, error) {
	response, err := client.http.Get(ctx, searchPath+query, "application/json")
	if err != nil {
		return nil, err
	}
	var payload searchResponse
	if err := json.Unmarshal(response.Body, &payload); err != nil {
		return nil, fmt.Errorf("decode TeacherHorizons search: %w", err)
	}
	return payload.Jobs, nil
}

func (client *Client) total(ctx context.Context) (int, error) {
	response, err := client.http.Get(ctx, countPath, "application/json")
	if err != nil {
		return 0, err
	}
	var payload countResponse
	if err := json.Unmarshal(response.Body, &payload); err != nil {
		return 0, fmt.Errorf("decode TeacherHorizons count: %w", err)
	}
	if payload.Count <= 0 {
		return 0, fmt.Errorf("TeacherHorizons reported no open jobs")
	}
	return payload.Count, nil
}

func (client *Client) loadLists(ctx context.Context) {
	client.listsOnce.Do(func() {
		response, err := client.http.Get(ctx, listsPath, "application/json")
		if err != nil {
			return
		}
		_ = json.Unmarshal(response.Body, &client.lists)
	})
}

func jobURL(id int) string {
	return "https://www.teacherhorizons.com/jobs/" + strconv.Itoa(id)
}

func epochDate(milliseconds int64) string {
	if milliseconds <= 0 {
		return ""
	}
	return time.UnixMilli(milliseconds).UTC().Format("2006-01-02")
}
