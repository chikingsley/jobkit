package seriousteachers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
)

func TestFullDiscoveryWalksSubjectsOnlyForFilledCountryPages(t *testing.T) {
	t.Parallel()
	filled := make([]string, 0, pageSize)
	for id := 100; id < 100+pageSize; id++ {
		filled = append(filled, fmt.Sprintf(`<a href="/job_details/%d/0/filled">Job</a>`, id))
	}
	subjectWalks := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/jobs/0/0/all":
			_, _ = fmt.Fprint(writer, `<select><option value="0">List all</option><option value="7">Georgia</option><option value="8">Chile</option></select>`)
		case "/jobs/0/7/all":
			_, _ = fmt.Fprint(writer, strings.Join(filled, ""))
		case "/jobs/1/7/all":
			subjectWalks++
			_, _ = fmt.Fprint(writer, `<a href="/job_details/999/0/subject">Hidden job</a>`)
		case "/jobs/0/8/all":
			_, _ = fmt.Fprint(writer, `<a href="/job_details/2000/0/small">Job</a>`)
		case "/jobs/1/8/all":
			subjectWalks++
			_, _ = fmt.Fprint(writer, `<a href="/job_details/2001/0/never">Never fetched</a>`)
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	client, err := NewClient(server.URL, server.Client(), 0, Credentials{})
	if err != nil {
		t.Fatal(err)
	}
	client.subjectIDs = []int{1}
	discovery, err := client.Discover(context.Background(), inventory.ModeFull)
	if err != nil {
		t.Fatal(err)
	}
	if !discovery.Complete {
		t.Fatalf("discovery = %#v", discovery)
	}
	if len(discovery.Items) != pageSize+2 {
		t.Fatalf("expected %d items, got %d", pageSize+2, len(discovery.Items))
	}
	if subjectWalks != 1 {
		t.Fatalf("expected one subject walk for the filled country, got %d", subjectWalks)
	}
	for _, item := range discovery.Items {
		if item.ID == "2001" {
			t.Fatal("walked subjects for a country that did not fill its page")
		}
	}
}

func TestParseDetailKeepsGatedApplicationRoute(t *testing.T) {
	t.Parallel()
	body := []byte(`<html><body><main class="container-fluid"><div class="col-sm-8">
		<h1>University English Teacher</h1><h5>(Georgia, Tbilisi)</h5>
		<div class="text-start text-break"><b>Start Date:</b> September<br><b>Salary:</b> 3000 GEL</div>
		<a href="/te2/login/99/12">Apply</a>
	</div></main></body></html>`)
	record, err := ParseDetail("99", "https://www.seriousteachers.com/job_details/99/0/", body)
	if err != nil {
		t.Fatal(err)
	}
	if record.Title != "University English Teacher" || record.Fields["Salary"] != "3000 GEL" {
		t.Fatalf("record = %#v", record)
	}
	if record.ApplyURL != "https://www.seriousteachers.com/te2/login/99/12" {
		t.Fatalf("apply URL = %q", record.ApplyURL)
	}
	if record.Country != "" {
		t.Fatalf("parser guessed country from location: %q", record.Country)
	}
}
