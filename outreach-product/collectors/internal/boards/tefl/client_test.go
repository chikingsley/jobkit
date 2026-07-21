package tefl

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
)

func TestDiscoverStopsAtEmptyPage(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("pageNo") == "2" {
			_, _ = fmt.Fprint(writer, `<html></html>`)
			return
		}
		_, _ = fmt.Fprint(writer, `<a href="jobpage.html?jobId=42&countryId=1">View</a>`)
	}))
	t.Cleanup(server.Close)
	client, err := NewClient(server.URL, server.Client(), 0)
	if err != nil {
		t.Fatal(err)
	}
	discovery, err := client.Discover(context.Background(), inventory.ModeFull)
	if err != nil {
		t.Fatal(err)
	}
	if !discovery.Complete || len(discovery.Items) != 1 || discovery.Items[0].ID != "42" {
		t.Fatalf("discovery = %#v", discovery)
	}
}

func TestParseDetailUsesJSONLDWithoutProseSalaryExtraction(t *testing.T) {
	t.Parallel()
	body := []byte(`<html><body><script type="application/ld+json">{
		"@type":"JobPosting","title":"Academic English Teacher","datePosted":"2026-07-19T10:00:00Z",
		"validThrough":"2026-08-01","hiringOrganization":{"name":"Example School"},
		"jobLocation":{"name":"Warsaw","address":{"addressCountry":"Poland"}},
		"description":"<p>Salary and Benefits 9000 PLN. Teach adults.</p>"
	}</script></body></html>`)
	record, err := ParseDetail("42", "https://www.tefl.com/job-seeker/jobpage.html?jobId=42", body)
	if err != nil {
		t.Fatal(err)
	}
	if record.Company != "Example School" || record.Country != "Poland" || record.PostedDate != "2026-07-19" {
		t.Fatalf("record = %#v", record)
	}
	if record.Salary != "" {
		t.Fatalf("prose salary leaked into canonical field: %q", record.Salary)
	}
	if record.Fields["job_posting_json_ld"] == "" {
		t.Fatal("missing JSON-LD evidence")
	}
}
