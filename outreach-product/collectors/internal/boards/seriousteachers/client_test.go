package seriousteachers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
)

func TestFullDiscoveryWalksCountrySubjectMatrix(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/":
			_, _ = fmt.Fprint(writer, `<select><option value="0">List all</option><option value="7">Georgia</option></select><a href="/job_details/1/0/home">Job</a>`)
		case "/0/7/0":
			_, _ = fmt.Fprint(writer, `<a href="/job_details/1/0/home">Existing job</a><a href="/job_details/2/0/country">Job</a>`)
		case "/0/7/1":
			_, _ = fmt.Fprint(writer, `<a href="/job_details/3/0/subject">Job</a>`)
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
	if !discovery.Complete || len(discovery.Items) != 3 {
		t.Fatalf("discovery = %#v", discovery)
	}
	if discovery.Items[0].Metadata["country"] != "Georgia" {
		t.Fatalf("duplicate metadata = %#v", discovery.Items[0].Metadata)
	}
	if discovery.Items[2].Metadata["country"] != "Georgia" {
		t.Fatalf("subject metadata = %#v", discovery.Items[2].Metadata)
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
