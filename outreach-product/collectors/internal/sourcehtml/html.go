package sourcehtml

import (
	"bytes"
	"encoding/hex"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/net/html"
)

var emailPattern = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)

var blockElements = map[string]struct{}{
	"address": {}, "article": {}, "aside": {}, "blockquote": {}, "br": {},
	"div": {}, "dl": {}, "fieldset": {}, "footer": {}, "form": {},
	"h1": {}, "h2": {}, "h3": {}, "h4": {}, "h5": {}, "h6": {},
	"header": {}, "hr": {}, "li": {}, "main": {}, "nav": {}, "ol": {},
	"p": {}, "pre": {}, "section": {}, "table": {}, "tr": {}, "ul": {},
}

// Parse creates a queryable HTML document.
func Parse(body []byte) (*goquery.Document, error) {
	return goquery.NewDocumentFromReader(bytes.NewReader(body))
}

// Clean collapses source whitespace, including non-breaking spaces.
func Clean(value string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(value, "\u00a0", " ")), " ")
}

// Attr returns a trimmed attribute value.
func Attr(selection *goquery.Selection, name string) string {
	value, _ := selection.Attr(name)
	return strings.TrimSpace(value)
}

// FirstEmail returns the first syntactically recognizable address.
func FirstEmail(value string) string {
	return emailPattern.FindString(value)
}

// Emails returns syntactically recognizable addresses in source order without duplicates.
func Emails(value string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, address := range emailPattern.FindAllString(value, -1) {
		if _, duplicate := seen[address]; duplicate {
			continue
		}
		seen[address] = struct{}{}
		result = append(result, address)
	}
	return result
}

// IsBlockElement reports whether an HTML element introduces a readable text boundary.
func IsBlockElement(name string) bool {
	_, exists := blockElements[name]
	return exists
}

// IsNoiseElement reports whether an HTML element should be excluded from readable source text.
func IsNoiseElement(name string) bool {
	switch name {
	case "script", "style", "noscript", "svg", "template":
		return true
	default:
		return false
	}
}

// DecodeCloudflareEmail decodes Cloudflare's data-cfemail XOR representation.
func DecodeCloudflareEmail(encoded string) string {
	data, err := hex.DecodeString(strings.TrimSpace(encoded))
	if err != nil || len(data) < 2 {
		return ""
	}
	key := data[0]
	decoded := make([]byte, len(data)-1)
	for index, value := range data[1:] {
		decoded[index] = value ^ key
	}
	return string(decoded)
}

// DecodeCloudflareNodes replaces obfuscated node contents with their address.
func DecodeCloudflareNodes(document *goquery.Document) {
	document.Find("[data-cfemail]").Each(func(_ int, selection *goquery.Selection) {
		decoded := DecodeCloudflareEmail(Attr(selection, "data-cfemail"))
		if decoded != "" {
			selection.SetText(decoded)
		}
	})
}

// FirstDocumentEmail checks decoded Cloudflare nodes, mailto links, then visible text.
func FirstDocumentEmail(document *goquery.Document) string {
	DecodeCloudflareNodes(document)
	if value := FirstEmail(document.Find("[data-cfemail]").First().Text()); value != "" {
		return value
	}
	if href := Attr(document.Find(`a[href^="mailto:"]`).First(), "href"); href != "" {
		address := strings.TrimSpace(strings.SplitN(strings.TrimPrefix(href, "mailto:"), "?", 2)[0])
		if FirstEmail(address) == address {
			return address
		}
	}
	return FirstEmail(document.Text())
}

// VisibleText extracts readable text with block boundaries retained as
// newlines. This avoids concatenating headings and paragraphs when a source
// embeds HTML inside JSON-LD.
func VisibleText(selection *goquery.Selection) string {
	var builder strings.Builder
	for _, node := range selection.Nodes {
		appendVisibleText(&builder, node)
	}
	lines := strings.Split(builder.String(), "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		if line = Clean(line); line != "" {
			cleaned = append(cleaned, line)
		}
	}
	return strings.Join(cleaned, "\n")
}

func appendVisibleText(builder *strings.Builder, node *html.Node) {
	if node.Type == html.TextNode {
		builder.WriteString(node.Data)
		return
	}
	if node.Type == html.ElementNode {
		if IsNoiseElement(node.Data) {
			return
		}
	}
	block := IsBlockElement(node.Data)
	if block && builder.Len() > 0 {
		builder.WriteByte('\n')
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		appendVisibleText(builder, child)
	}
	if block {
		builder.WriteByte('\n')
	}
}
