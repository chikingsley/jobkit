package tefl

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehtml"
)

// ParseDetail reads the authoritative JobPosting JSON-LD and retains the
// original structured object as source evidence. It intentionally does not
// derive salary or requirements from the prose description.
func ParseDetail(jobID, sourceURL string, body []byte) (inventory.Record, error) {
	document, err := sourcehtml.Parse(body)
	if err != nil {
		return inventory.Record{}, err
	}
	job, encoded, err := jobPostingJSON(document)
	if err != nil {
		return inventory.Record{}, err
	}
	title := cleanString(job["title"])
	if title == "" {
		title = sourcehtml.Clean(document.Find("h2").First().Text())
	}
	company := organizationName(job["hiringOrganization"])
	location, country := locationFields(job["jobLocation"])
	descriptionHTML := cleanString(job["description"])
	description := descriptionText(descriptionHTML)
	posted := dateOnly(cleanString(job["datePosted"]))
	closing := dateOnly(cleanString(job["validThrough"]))
	applyEmail := sourcehtml.FirstDocumentEmail(document)
	fields := map[string]string{}
	if len(encoded) > 0 {
		fields["job_posting_json_ld"] = string(encoded)
	}
	if closing != "" {
		fields["closing"] = closing
	}
	return inventory.Record{
		Board:       Board,
		JobID:       jobID,
		URL:         sourceURL,
		Title:       title,
		Company:     company,
		Location:    location,
		Country:     country,
		ApplyEmail:  applyEmail,
		ApplyURL:    sourceURL,
		PostedDate:  posted,
		Description: description,
		Raw:         description,
		Fields:      fields,
	}, nil
}

func jobPostingJSON(document *goquery.Document) (map[string]any, []byte, error) {
	var found map[string]any
	var encoded []byte
	document.Find(`script[type="application/ld+json"]`).EachWithBreak(func(_ int, selection *goquery.Selection) bool {
		candidate := strings.TrimSpace(selection.Text())
		if candidate == "" {
			return true
		}
		var value any
		if err := json.Unmarshal([]byte(candidate), &value); err != nil {
			return true
		}
		object := findJobPosting(value)
		if object == nil {
			return true
		}
		found = object
		encoded, _ = json.Marshal(object)
		return false
	})
	if found == nil {
		return map[string]any{}, nil, fmt.Errorf("detail page exposed no JobPosting JSON-LD")
	}
	return found, encoded, nil
}

func findJobPosting(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		if cleanString(typed["@type"]) == "JobPosting" {
			return typed
		}
		if graph, ok := typed["@graph"].([]any); ok {
			for _, item := range graph {
				if found := findJobPosting(item); found != nil {
					return found
				}
			}
		}
	case []any:
		for _, item := range typed {
			if found := findJobPosting(item); found != nil {
				return found
			}
		}
	}
	return nil
}

func organizationName(value any) string {
	if object, ok := value.(map[string]any); ok {
		return cleanString(object["name"])
	}
	return cleanString(value)
}

func locationFields(value any) (string, string) {
	if values, ok := value.([]any); ok && len(values) > 0 {
		return locationFields(values[0])
	}
	object, ok := value.(map[string]any)
	if !ok {
		return cleanString(value), ""
	}
	location := cleanString(object["name"])
	country := ""
	if address, ok := object["address"].(map[string]any); ok {
		country = cleanString(address["addressCountry"])
		if location == "" {
			location = cleanString(address["addressLocality"])
		}
	}
	return location, country
}

func descriptionText(value string) string {
	if value == "" {
		return ""
	}
	document, err := sourcehtml.Parse([]byte(value))
	if err != nil {
		return sourcehtml.Clean(value)
	}
	document.Find("script,style,noscript").Remove()
	return sourcehtml.Clean(sourcehtml.VisibleText(document.Selection))
}

func cleanString(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return sourcehtml.Clean(text)
}

func dateOnly(value string) string {
	if len(value) >= 10 && value[4] == '-' && value[7] == '-' {
		return value[:10]
	}
	return value
}
