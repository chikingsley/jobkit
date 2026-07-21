package eslcafe

import (
	"bytes"
	"net/url"
	"strings"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/sourcehtml"
	"golang.org/x/net/html"
)

// ParseDetail extracts a posting from either ESL Cafe's normal job-details
// markup or a free-form advertiser page. The list summary remains canonical
// identity, so valid source rows are never dropped because their presentation
// template differs.
func ParseDetail(summary Summary, sourceURL string, body []byte) (Posting, error) {
	document, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return Posting{}, err
	}
	details := findElement(document, func(node *html.Node) bool {
		return node.Data == "div" && hasClass(node, "job-details")
	})
	contentRoot := details
	structured := contentRoot != nil
	if contentRoot == nil {
		contentRoot = findElement(document, func(node *html.Node) bool { return node.Data == "body" })
	}
	if contentRoot == nil {
		contentRoot = document
	}
	decodeCloudflareNodes(contentRoot)

	posting := inventory.Record{
		Board:       InventoryBoard,
		SourceBoard: summary.Board,
		JobID:       strings.TrimSpace(summary.Slug),
		URL:         sourceURL,
		Title:       strings.TrimSpace(summary.Title),
		Company:     strings.TrimSpace(summary.Company),
		Country:     sourceCountry(summary.Board),
		PostedDate:  formatPostedDate(summary.StatusStartDate),
	}
	if posting.Title == "" {
		if heading := findElement(contentRoot, func(node *html.Node) bool { return node.Data == "h1" }); heading != nil {
			posting.Title = cleanInlineText(heading)
		}
	}

	if structured {
		author := findElement(contentRoot, func(node *html.Node) bool {
			return node.Data == "div" && hasClass(node, "author-desc")
		})
		if author != nil {
			posting.Location = leadingText(author)
			if company := labeledValue(author, "posted by"); company != "" {
				posting.Company = company
			}
			posting.ApplyEmail = labeledEmail(author, "contact")
		}
	}

	posting.Raw = visibleDescription(contentRoot, structured)
	posting.Description = compactWhitespace(posting.Raw)
	if posting.ApplyEmail == "" {
		posting.ApplyEmail = sourcehtml.FirstEmail(posting.Raw)
	}
	posting.ApplyURL = firstExternalURL(contentRoot, sourceURL, !structured)
	return posting, nil
}

func sourceCountry(board string) string {
	switch board {
	case "china":
		return "China"
	case "korea":
		return "South Korea"
	default:
		return ""
	}
}

func findElement(root *html.Node, predicate func(*html.Node) bool) *html.Node {
	if root.Type == html.ElementNode && predicate(root) {
		return root
	}
	for child := root.FirstChild; child != nil; child = child.NextSibling {
		if found := findElement(child, predicate); found != nil {
			return found
		}
	}
	return nil
}

func findElements(root *html.Node, predicate func(*html.Node) bool, found *[]*html.Node) {
	if root.Type == html.ElementNode && predicate(root) {
		*found = append(*found, root)
	}
	for child := root.FirstChild; child != nil; child = child.NextSibling {
		findElements(child, predicate, found)
	}
}

func hasClass(node *html.Node, wanted string) bool {
	for _, item := range node.Attr {
		if item.Key != "class" {
			continue
		}
		for _, className := range strings.Fields(item.Val) {
			if className == wanted {
				return true
			}
		}
	}
	return false
}

func attribute(node *html.Node, name string) string {
	for _, item := range node.Attr {
		if item.Key == name {
			return item.Val
		}
	}
	return ""
}

func cleanInlineText(node *html.Node) string {
	var parts []string
	collectInlineText(node, &parts)
	return strings.Join(parts, " ")
}

func collectInlineText(node *html.Node, parts *[]string) {
	if node.Type == html.TextNode {
		if text := strings.Join(strings.Fields(node.Data), " "); text != "" {
			*parts = append(*parts, text)
		}
		return
	}
	if isNoiseElement(node) {
		return
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		collectInlineText(child, parts)
	}
}

func leadingText(author *html.Node) string {
	var parts []string
	for child := author.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == html.ElementNode && child.Data == "br" {
			break
		}
		if text := cleanInlineText(child); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, " ")
}

func labeledValue(author *html.Node, wanted string) string {
	var labels []*html.Node
	findElements(author, func(node *html.Node) bool { return node.Data == "strong" }, &labels)
	for _, label := range labels {
		name := strings.ToLower(strings.TrimSuffix(cleanInlineText(label), ":"))
		if name != wanted {
			continue
		}
		var parts []string
		for sibling := label.NextSibling; sibling != nil; sibling = sibling.NextSibling {
			if sibling.Type == html.ElementNode && (sibling.Data == "br" || sibling.Data == "strong") {
				break
			}
			if text := cleanInlineText(sibling); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.TrimSpace(strings.Join(parts, " "))
	}
	return ""
}

func labeledEmail(author *html.Node, wanted string) string {
	var labels []*html.Node
	findElements(author, func(node *html.Node) bool { return node.Data == "strong" }, &labels)
	for _, label := range labels {
		name := strings.ToLower(strings.TrimSuffix(cleanInlineText(label), ":"))
		if name != wanted {
			continue
		}
		for sibling := label.NextSibling; sibling != nil; sibling = sibling.NextSibling {
			if sibling.Type == html.ElementNode && (sibling.Data == "br" || sibling.Data == "strong") {
				break
			}
			if email := sourcehtml.FirstEmail(cleanInlineText(sibling)); email != "" {
				return email
			}
		}
	}
	return ""
}

func decodeCloudflareNodes(root *html.Node) {
	var encodedNodes []*html.Node
	findElements(root, func(node *html.Node) bool {
		return attribute(node, "data-cfemail") != ""
	}, &encodedNodes)
	for _, node := range encodedNodes {
		decoded := sourcehtml.DecodeCloudflareEmail(attribute(node, "data-cfemail"))
		if decoded == "" {
			continue
		}
		for child := node.FirstChild; child != nil; {
			next := child.NextSibling
			node.RemoveChild(child)
			child = next
		}
		node.AppendChild(&html.Node{Type: html.TextNode, Data: decoded})
	}
}

func firstExternalURL(root *html.Node, sourceURL string, preferApplication bool) string {
	source, _ := url.Parse(sourceURL)
	var anchors []*html.Node
	findElements(root, func(node *html.Node) bool { return node.Data == "a" }, &anchors)
	first := ""
	for _, anchor := range anchors {
		href := strings.TrimSpace(attribute(anchor, "href"))
		parsed, err := url.Parse(href)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			continue
		}
		if source != nil && strings.EqualFold(parsed.Hostname(), source.Hostname()) {
			continue
		}
		if strings.Contains(parsed.Path, "/cdn-cgi/") {
			continue
		}
		if first == "" {
			first = href
		}
		if preferApplication && applicationLink(anchor, parsed) {
			return href
		}
		if !preferApplication {
			return href
		}
	}
	return first
}

func applicationLink(anchor *html.Node, parsed *url.URL) bool {
	candidate := strings.ToLower(strings.Join([]string{
		parsed.Path,
		parsed.RawQuery,
		cleanInlineText(anchor),
	}, " "))
	for _, marker := range []string{"apply", "application", "career", "job", "register", "recruit"} {
		if strings.Contains(candidate, marker) {
			return true
		}
	}
	return false
}

func visibleDescription(root *html.Node, structured bool) string {
	var builder strings.Builder
	for child := root.FirstChild; child != nil; child = child.NextSibling {
		if structured && child.Type == html.ElementNode && (child.Data == "h1" || hasClass(child, "author-desc")) {
			continue
		}
		appendVisibleText(&builder, child)
	}
	lines := strings.Split(builder.String(), "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.Join(strings.Fields(line), " ")
		if line != "" {
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
	if isNoiseElement(node) {
		return
	}
	block := sourcehtml.IsBlockElement(node.Data)
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

func isNoiseElement(node *html.Node) bool {
	if node.Type != html.ElementNode {
		return false
	}
	return sourcehtml.IsNoiseElement(node.Data)
}

func compactWhitespace(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

func formatPostedDate(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) >= 16 && raw[4] == '-' && raw[7] == '-' && raw[10] == 'T' {
		return raw[:10] + " " + raw[11:16]
	}
	return raw
}
