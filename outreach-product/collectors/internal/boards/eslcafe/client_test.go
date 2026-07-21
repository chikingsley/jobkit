package eslcafe

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
)

func TestDiscoverValidatesCompletePagination(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.URL.Path != listPath {
			t.Fatalf("path = %q, want %q", request.URL.Path, listPath)
		}
		if got := request.Header.Get("Accept"); got != "application/json" {
			t.Fatalf("Accept = %q", got)
		}
		if got := request.URL.Query().Get("jobBoardSlug"); got != "international" {
			t.Fatalf("jobBoardSlug = %q", got)
		}
		page, err := strconv.Atoi(request.URL.Query().Get("page"))
		if err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("Content-Type", "application/json")
		switch page {
		case 1:
			_, err = fmt.Fprint(writer, `{"paging":{"page":1,"lastPage":2,"size":60,"total":3},"data":[{"jobTitle":"One","company":"A","slug":"one"},{"jobTitle":"Two","company":"B","slug":"two"}]}`)
		case 2:
			_, err = fmt.Fprint(writer, `{"paging":{"page":2,"lastPage":2,"size":60,"total":3},"data":[{"jobTitle":"Three","company":"C","slug":"three"}]}`)
		default:
			t.Fatalf("unexpected page %d", page)
		}
		if err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, server.Client(), 0, "international")
	if err != nil {
		t.Fatal(err)
	}
	discovery, err := client.Discover(context.Background(), inventory.ModeFull)
	if err != nil {
		t.Fatal(err)
	}
	if !discovery.Complete || len(discovery.Items) != 3 {
		t.Fatalf("discovery = %#v", discovery)
	}
	if discovery.Evidence["source_total"] != "3" || discovery.Evidence["pages_checked"] != "2" {
		t.Fatalf("evidence = %#v", discovery.Evidence)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("calls = %d, want 2", got)
	}
}

func TestDiscoverRejectsReportedTotalMismatch(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(writer, `{"paging":{"page":1,"lastPage":1,"size":60,"total":2},"data":[{"slug":"one"}]}`)
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(server.URL, server.Client(), 0, "korea")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Discover(context.Background(), inventory.ModeFull); err == nil {
		t.Fatal("expected source-total mismatch")
	}
}

func TestHTTPErrorClassifiesRetryableStatuses(t *testing.T) {
	t.Parallel()
	if !(HTTPError{StatusCode: http.StatusServiceUnavailable}).Retryable() {
		t.Fatal("503 should be retryable")
	}
	if (HTTPError{StatusCode: http.StatusNotFound}).Retryable() {
		t.Fatal("404 should not be retryable")
	}
}
