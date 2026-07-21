package anesl

import (
	"context"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
)

func TestDiscoverWalksWebFormsPager(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		page := "1"
		if request.Method == http.MethodPost {
			if err := request.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if request.Form.Get("__EVENTTARGET") == pagerTarget {
				page = request.Form.Get("__EVENTARGUMENT")
			}
		}
		id := "10"
		offerID := "AB100"
		if page == "2" {
			id = "11"
			offerID = "AB110"
		}
		_, _ = fmt.Fprintf(writer, `<input type="hidden" name="__VIEWSTATE" value="state-%s">
			Total Records:<b>2</b> Pages:<b>2</b> Current Page:<b>%s</b>
			<table cellspacing="1"><tr><td><a href="jobdetail.aspx?id=%s">%s</a></td>
			<td><table cellspacing="0"><tr><td><a href="jobdetail.aspx?id=%s">University English Teacher</a></td></tr></table></td>
			<td>Salary: 7500 PLN</td></tr></table>`, page, page, id, offerID, id)
	}))
	t.Cleanup(server.Close)
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client, err := NewClient(server.URL, &http.Client{Jar: jar}, 0)
	if err != nil {
		t.Fatal(err)
	}
	discovery, err := client.Discover(context.Background(), inventory.ModeFull)
	if err != nil {
		t.Fatal(err)
	}
	if !discovery.Complete || len(discovery.Items) != 2 {
		t.Fatalf("discovery = %#v", discovery)
	}
}

func TestListingItemsPreserveDistinctOffersSharingOneDetailRoute(t *testing.T) {
	t.Parallel()
	body := []byte(`<html><body>
		<table cellspacing="1"><tr><td><a href="jobdetail.aspx?id=123">ZJ1321</a></td>
		<td><table cellspacing="0"><tr><td><a href="jobdetail.aspx?id=123">Business English Teacher</a></td></tr></table></td>
		<td>Salary: 8000 - 12000</td></tr></table>
		<table cellspacing="1"><tr><td><a href="jobdetail.aspx?id=123">ZJ1322</a></td>
		<td><table cellspacing="0"><tr><td><a href="jobdetail.aspx?id=123">University English Teacher</a></td></tr></table></td>
		<td>Salary: 7000 - 10000</td></tr></table>
	</body></html>`)
	candidates, err := listingCandidates(body)
	if err != nil {
		t.Fatal(err)
	}
	items, collisions, err := finalizeListingItems(candidates)
	if err != nil {
		t.Fatal(err)
	}
	if collisions != 2 || len(items) != 2 {
		t.Fatalf("collisions=%d items=%#v", collisions, items)
	}
	if items[0].ID != "123:zj1321" || items[1].ID != "123:zj1322" {
		t.Fatalf("items=%#v", items)
	}
}

func TestParseDetailPreservesLabelValueEvidence(t *testing.T) {
	t.Parallel()
	body := []byte(`<html><head><title>Fallback</title></head><body><table>
		<tr><td>AB123</td><td>University English Teacher</td></tr>
		<tr><td>Location:</td><td>Warsaw, Poland</td></tr>
		<tr><td>Salary/M:</td><td>7500 PLN</td></tr>
		<tr><td>Degree:</td><td>Bachelor's degree</td></tr>
	</table>Apply via hr@anesl.com or other@example.com</body></html>`)
	record, err := ParseDetail("123", "https://cafe.anesl.com/jobdetail.aspx?id=123", body)
	if err != nil {
		t.Fatal(err)
	}
	if record.Title != "University English Teacher" || record.Salary != "7500 PLN" {
		t.Fatalf("record = %#v", record)
	}
	if record.ApplyEmail != "hr@anesl.com" || record.DegreeRequired != "Bachelor's degree" {
		t.Fatalf("record = %#v", record)
	}
}
