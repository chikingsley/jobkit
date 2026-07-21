package ajarn

import (
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehtml"
)

var postedPrefix = regexp.MustCompile(`(?i)^Posted\s*`)

// ParseDetail converts Ajarn's fixed summary table and main description into a
// source record. Salary comes from the observed salary table cell, not prose.
func ParseDetail(jobID, slug, sourceURL string, body []byte) (inventory.Record, error) {
	document, err := sourcehtml.Parse(body)
	if err != nil {
		return inventory.Record{}, err
	}
	document.Find("script,style,noscript").Remove()
	title := sourcehtml.Clean(document.Find("h1").First().Text())
	if title == "" {
		title = strings.Split(sourcehtml.Clean(document.Find("title").First().Text()), " job in ")[0]
	}
	rows := summaryRows(document)
	company, location, salary := "", "", ""
	if len(rows) > 0 {
		company = rows[0]
	}
	if len(rows) > 1 {
		location = rows[1]
	}
	if len(rows) > 2 {
		salary = rows[2]
	}
	raw := sourcehtml.Clean(
		sourcehtml.VisibleText(document.Find("div.col-md-pull-4.col-md-8").First()),
	)
	posted := sourcehtml.Clean(document.Find("h3.text-muted").First().Text())
	posted = strings.TrimSpace(postedPrefix.ReplaceAllString(posted, ""))
	applyEmail := sourcehtml.FirstDocumentEmail(document)
	applyURL := ""
	if applyEmail == "" {
		applyURL = sourceURL
	}
	fields := map[string]string{}
	if salary != "" {
		fields["source_salary"] = salary
	}
	return inventory.Record{
		Board:       Board,
		JobID:       jobID,
		URL:         sourceURL,
		Title:       title,
		Company:     company,
		Location:    location,
		Country:     "Thailand",
		Salary:      salary,
		ApplyEmail:  applyEmail,
		ApplyURL:    applyURL,
		PostedDate:  posted,
		Description: raw,
		Raw:         raw,
		Fields:      fields,
	}, nil
}

func summaryRows(document *goquery.Document) []string {
	var rows []string
	document.Find("table.table").First().Find("tr").Each(func(_ int, row *goquery.Selection) {
		var cells []string
		row.Find("td,th").Each(func(_ int, cell *goquery.Selection) {
			if text := sourcehtml.Clean(cell.Text()); text != "" {
				cells = append(cells, text)
			}
		})
		text := strings.Join(cells, " ")
		if text != "" && !strings.Contains(strings.ToLower(text), "[email") {
			rows = append(rows, text)
		}
	})
	return rows
}
