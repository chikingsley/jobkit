package anesl

import (
	"regexp"
	"sort"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehtml"
)

const labelMaxLength = 40

var positionCodePattern = regexp.MustCompile(`^[A-Z]{1,3}\d{3,}$`)

// ParseDetail preserves every label/value pair and promotes only explicitly
// labeled source facts into canonical columns.
func ParseDetail(jobID, sourceURL string, body []byte) (inventory.Record, error) {
	document, err := sourcehtml.Parse(body)
	if err != nil {
		return inventory.Record{}, err
	}
	fields := map[string]string{}
	title := ""
	document.Find("tr").Each(func(_ int, row *goquery.Selection) {
		var cells []string
		row.Find("td,th").Each(func(_ int, cell *goquery.Selection) {
			if text := sourcehtml.Clean(cell.Text()); text != "" {
				cells = append(cells, text)
			}
		})
		if len(cells) < 2 {
			return
		}
		label := strings.TrimSpace(cells[0])
		if strings.HasSuffix(label, ":") && len(label) < labelMaxLength {
			fields[strings.TrimSpace(strings.TrimSuffix(label, ":"))] = cells[1]
			return
		}
		if len(cells) == 2 && title == "" && positionCodePattern.MatchString(label) {
			title = cells[1]
		}
	})
	if title == "" {
		title = sourcehtml.Clean(document.Find("title").First().Text())
	}
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		lines = append(lines, key+": "+fields[key])
	}
	raw := strings.Join(lines, "\n")
	emails := sourcehtml.Emails(string(body))
	applyEmail := ""
	for _, email := range emails {
		if strings.HasSuffix(strings.ToLower(email), "@anesl.com") {
			applyEmail = email
			break
		}
	}
	if applyEmail == "" && len(emails) > 0 {
		applyEmail = emails[0]
	}
	company := firstField(fields, "Employer", "Employer's Name", "School", "Company")
	country := fields["Country"]
	if country == "" {
		country = "China"
	}
	return inventory.Record{
		Board:          Board,
		JobID:          jobID,
		URL:            sourceURL,
		Title:          title,
		Company:        company,
		Location:       fields["Location"],
		Country:        country,
		Salary:         firstField(fields, "Salary/M", "Salary"),
		DegreeRequired: fields["Degree"],
		ApplyEmail:     applyEmail,
		Description:    raw,
		Raw:            raw,
		Fields:         fields,
	}, nil
}

func firstField(fields map[string]string, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(fields[name]); value != "" {
			return value
		}
	}
	return ""
}
