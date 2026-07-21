package ajarn

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
)

func TestDiscoverProvesRepeatedSecondPage(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(writer, `<a href="/recruitment/jobs/12/teacher">One</a><a href="/recruitment/jobs/12/teacher">Duplicate</a>`)
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
	if !discovery.Complete || len(discovery.Items) != 1 || discovery.Items[0].ID != "12" {
		t.Fatalf("discovery = %#v", discovery)
	}
}

func TestParseDetailKeepsExplicitSourceFields(t *testing.T) {
	t.Parallel()
	body := []byte(`<html><head><title>Fallback job in Thailand</title></head><body>
		<h1>English Teacher</h1><table class="table">
		<tr><td>Example School</td></tr><tr><td>Bangkok</td></tr><tr><td>60,000 baht</td></tr>
		</table><h3 class="text-muted">Posted 2 days ago</h3>
		<div class="col-md-pull-4 col-md-8"><p>Teach primary learners.</p><a href="mailto:jobs@example.com">Email</a></div>
	</body></html>`)
	record, err := ParseDetail("12", "teacher", "https://www.ajarn.com/recruitment/jobs/12/teacher", body)
	if err != nil {
		t.Fatal(err)
	}
	if record.Company != "Example School" || record.Location != "Bangkok" || record.Salary != "60,000 baht" {
		t.Fatalf("record = %#v", record)
	}
	if record.ApplyEmail != "jobs@example.com" || record.Country != "Thailand" {
		t.Fatalf("record = %#v", record)
	}
}
