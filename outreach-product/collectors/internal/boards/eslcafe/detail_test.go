package eslcafe

import (
	"encoding/hex"
	"strings"
	"testing"
)

func TestParseDetailExtractsStructuredFields(t *testing.T) {
	t.Parallel()
	email := "jobs@example.edu"
	encoded := encodeCloudflareEmail(email, 0x4a)
	body := `<html><body><div class="job-details">
		<h1>University English Instructor</h1>
		<div class="author-desc">
			Seoul, South Korea<br>
			<strong>Posted by:</strong> Example University<br>
			<strong>Contact:</strong> <span data-cfemail="` + encoded + `">protected</span>
		</div>
		<p>Teach academic English to undergraduate students.</p>
		<p><a href="https://forms.example.edu/apply">Application form</a></p>
		<script>ignore me</script>
	</div></body></html>`
	posting, err := ParseDetail(
		Summary{Board: "international", Slug: "university-english", StatusStartDate: "2026-07-19T12:34:56"},
		"https://www.eslcafe.com/postajob-detail/university-english",
		[]byte(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	if posting.Title != "University English Instructor" || posting.Company != "Example University" {
		t.Fatalf("identity = %#v", posting)
	}
	if posting.Location != "Seoul, South Korea" || posting.ApplyEmail != email {
		t.Fatalf("contact = %#v", posting)
	}
	if posting.ApplyURL != "https://forms.example.edu/apply" {
		t.Fatalf("apply URL = %q", posting.ApplyURL)
	}
	if posting.PostedDate != "2026-07-19 12:34" {
		t.Fatalf("posted date = %q", posting.PostedDate)
	}
	if !strings.Contains(posting.Raw, "Teach academic English") || strings.Contains(posting.Raw, "ignore me") {
		t.Fatalf("raw = %q", posting.Raw)
	}
}

func TestParseDetailRetainsFreeFormAdvertiserPage(t *testing.T) {
	t.Parallel()
	email := "apply@example.cn"
	encoded := encodeCloudflareEmail(email, 0x31)
	body := `<html><head><style>noise</style></head><body>
		<div class="container">
			<h1>Teach in China</h1>
			<p>Bachelor degree required. Salary RMB 25,000 to 32,000 monthly.</p>
			<a href="https://youtube.example/watch">Video</a>
			<a href="https://school.example/teacher/register">Apply now</a>
			<span class="__cf_email__" data-cfemail="` + encoded + `">protected</span>
		</div>
	</body></html>`
	posting, err := ParseDetail(
		Summary{Board: "china", Slug: "free-form", Title: "Summary title", Company: "Example School"},
		"https://www.eslcafe.com/postajob-detail/free-form",
		[]byte(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	if posting.Title != "Summary title" || posting.Company != "Example School" {
		t.Fatalf("summary identity was not retained: %#v", posting)
	}
	if posting.ApplyEmail != email {
		t.Fatalf("email = %q", posting.ApplyEmail)
	}
	if posting.ApplyURL != "https://school.example/teacher/register" {
		t.Fatalf("apply URL = %q", posting.ApplyURL)
	}
	if strings.Contains(posting.Raw, "noise") || !strings.Contains(posting.Raw, "25,000") {
		t.Fatalf("raw = %q", posting.Raw)
	}
}

func encodeCloudflareEmail(email string, key byte) string {
	data := []byte{key}
	for _, value := range []byte(email) {
		data = append(data, value^key)
	}
	return hex.EncodeToString(data)
}
