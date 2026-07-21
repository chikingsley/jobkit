package seriousteachers

import (
	"net/url"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehtml"
	"golang.org/x/net/html"
)

const labelMaxLength = 40

// ParseDetail preserves the source's labeled body fields and gated application
// route. Country is supplied later from the explicit discovery route rather
// than guessed from the display location.
func ParseDetail(jobID, sourceURL string, body []byte) (inventory.Record, error) {
	document, err := sourcehtml.Parse(body)
	if err != nil {
		return inventory.Record{}, err
	}
	column := document.Find("main.container-fluid div.col-sm-8").First()
	if column.Length() == 0 {
		column = document.Selection
	}
	title := sourcehtml.Clean(column.Find("h1").First().Text())
	if title == "" {
		title = strings.Split(sourcehtml.Clean(document.Find("title").First().Text()), "|")[0]
	}
	location := sourcehtml.Clean(column.Find("h1").First().NextAllFiltered("h5").First().Text())
	location = strings.Trim(location, "() ")
	fields := map[string]string{}
	bodySelection := column.Find("div.text-start.text-break").First()
	if bodySelection.Length() > 0 {
		parseLabeledFields(bodySelection, fields)
	}
	raw := sourcehtml.Clean(sourcehtml.VisibleText(bodySelection))
	if raw == "" {
		raw = sourcehtml.Clean(document.Find(`meta[name="description"]`).First().AttrOr("content", ""))
	}
	applyURL := ""
	column.Find("a[href]").EachWithBreak(func(_ int, selection *goquery.Selection) bool {
		href := sourcehtml.Attr(selection, "href")
		match := applyPattern.FindStringSubmatch(href)
		if len(match) != 3 || match[1] != jobID {
			return true
		}
		base, err := url.Parse(sourceURL)
		if err != nil {
			return false
		}
		reference, err := url.Parse(href)
		if err != nil {
			return false
		}
		applyURL = base.ResolveReference(reference).String()
		fields["employer_id"] = match[2]
		return false
	})
	return inventory.Record{
		Board:       Board,
		JobID:       jobID,
		URL:         sourceURL,
		Title:       title,
		Location:    location,
		ApplyURL:    applyURL,
		Description: raw,
		Raw:         raw,
		Fields:      fields,
	}, nil
}

func parseLabeledFields(body *goquery.Selection, fields map[string]string) {
	body.Find("b,strong").Each(func(_ int, label *goquery.Selection) {
		name := strings.TrimSpace(strings.TrimSuffix(sourcehtml.Clean(label.Text()), ":"))
		if name == "" || len(name) > labelMaxLength || len(label.Nodes) == 0 {
			return
		}
		var parts []string
		for sibling := label.Nodes[0].NextSibling; sibling != nil; sibling = sibling.NextSibling {
			if sibling.Type == html.ElementNode &&
				(sibling.Data == "b" || sibling.Data == "strong" || sibling.Data == "br") {
				break
			}
			text := sourcehtml.Clean(goquery.NewDocumentFromNode(sibling).Text())
			if text != "" {
				parts = append(parts, text)
			}
		}
		if value := strings.Join(parts, " "); value != "" {
			if _, exists := fields[name]; !exists {
				fields[name] = value
			}
		}
	})
}
