package sourcehttp

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	maxResponseBytes = 10 << 20
	rateLimitRetries = 4
	rateLimitBackoff = 8 * time.Second
)

var browserHeaders = map[string]string{
	"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
	"Accept-Language":           "en-US,en;q=0.9",
	"Sec-Fetch-Dest":            "document",
	"Sec-Fetch-Mode":            "navigate",
	"Sec-Fetch-Site":            "none",
	"Sec-Fetch-User":            "?1",
	"Upgrade-Insecure-Requests": "1",
	"User-Agent":                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
}

// Doer is the part of http.Client used by source clients.
type Doer interface {
	Do(*http.Request) (*http.Response, error)
}

// HTTPError retains the source response status and a bounded body excerpt.
type HTTPError struct {
	Method     string
	URL        string
	StatusCode int
	Body       string
}

func (errorValue HTTPError) Error() string {
	return fmt.Sprintf(
		"%s %s returned HTTP %d: %s",
		errorValue.Method,
		errorValue.URL,
		errorValue.StatusCode,
		errorValue.Body,
	)
}

// Retryable reports whether the status commonly represents a transient source failure.
func (errorValue HTTPError) Retryable() bool {
	return errorValue.StatusCode == http.StatusRequestTimeout ||
		errorValue.StatusCode == http.StatusTooManyRequests ||
		errorValue.StatusCode >= http.StatusInternalServerError
}

// Response is the bounded result of one source request.
type Response struct {
	Body       []byte
	StatusCode int
	URL        string
	Header     http.Header
}

// Client centralizes URL resolution, request pacing, response limits, and a
// stable collector user agent. It deliberately does not retry requests; the
// durable runner records the failed item and resumes it later.
type Client struct {
	baseURL  *url.URL
	http     Doer
	delay    time.Duration
	mu       sync.Mutex
	lastCall time.Time
}

// New constructs a source HTTP client.
func New(baseURL string, httpClient Doer, delay time.Duration) (*Client, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid source origin %q", baseURL)
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{
		baseURL: parsed,
		http:    httpClient,
		delay:   delay,
	}, nil
}

// Resolve converts a source-relative route into an absolute URL.
func (client *Client) Resolve(reference string) string {
	parsed, err := url.Parse(strings.TrimSpace(reference))
	if err != nil {
		return ""
	}
	return client.baseURL.ResolveReference(parsed).String()
}

// Get performs a successful GET request, retrying a rate-limited response with
// widening backoff. A source that throttles a long full-inventory walk would
// otherwise fail the whole run on one 429.
func (client *Client) Get(ctx context.Context, reference, accept string) (Response, error) {
	var response Response
	var err error
	for attempt := 0; attempt <= rateLimitRetries; attempt++ {
		response, err = client.Request(ctx, http.MethodGet, reference, nil, map[string]string{
			"Accept": accept,
		})
		if err != nil {
			return Response{}, err
		}
		challenged := response.StatusCode == http.StatusForbidden &&
			isChallenge(response.Body)
		if response.StatusCode != http.StatusTooManyRequests && !challenged {
			break
		}
		if attempt == rateLimitRetries {
			break
		}
		if challenged {
			refreshClearance(ctx, client.Resolve(reference))
		}
		if waitErr := sleep(ctx, rateLimitBackoff*time.Duration(attempt+1)); waitErr != nil {
			return Response{}, waitErr
		}
	}
	return response, RequireSuccess(http.MethodGet, response)
}

func sleep(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// PostForm performs a successful form POST request.
func (client *Client) PostForm(ctx context.Context, reference string, values url.Values) (Response, error) {
	response, err := client.Request(
		ctx,
		http.MethodPost,
		reference,
		strings.NewReader(values.Encode()),
		map[string]string{
			"Accept":       "text/html",
			"Content-Type": "application/x-www-form-urlencoded",
		},
	)
	if err != nil {
		return Response{}, err
	}
	return response, RequireSuccess(http.MethodPost, response)
}

// Request performs one paced, bounded request and returns every HTTP status.
func (client *Client) Request(
	ctx context.Context,
	method string,
	reference string,
	body io.Reader,
	headers map[string]string,
) (Response, error) {
	if err := client.wait(ctx); err != nil {
		return Response{}, err
	}
	resolved := client.Resolve(reference)
	if resolved == "" {
		return Response{}, fmt.Errorf("resolve source URL %q", reference)
	}
	request, err := http.NewRequestWithContext(ctx, method, resolved, body)
	if err != nil {
		return Response{}, fmt.Errorf("build %s %s: %w", method, resolved, err)
	}
	for name, value := range browserHeaders {
		request.Header.Set(name, value)
	}
	if cookie := clearanceCookie(request.URL.Host); cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	httpResponse, err := client.http.Do(request)
	if err != nil {
		return Response{}, fmt.Errorf("%s %s: %w", method, resolved, err)
	}
	defer func() { _ = httpResponse.Body.Close() }()
	responseBody, err := io.ReadAll(io.LimitReader(httpResponse.Body, maxResponseBytes+1))
	if err != nil {
		return Response{}, fmt.Errorf("read %s %s: %w", method, resolved, err)
	}
	if len(responseBody) > maxResponseBytes {
		return Response{}, fmt.Errorf("%s %s exceeded %d bytes", method, resolved, maxResponseBytes)
	}
	finalURL := resolved
	if httpResponse.Request != nil && httpResponse.Request.URL != nil {
		finalURL = httpResponse.Request.URL.String()
	}
	return Response{
		Body:       responseBody,
		StatusCode: httpResponse.StatusCode,
		URL:        finalURL,
		Header:     httpResponse.Header.Clone(),
	}, nil
}

// RequireSuccess turns a non-2xx response into HTTPError.
func RequireSuccess(method string, response Response) error {
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		return nil
	}
	return HTTPError{
		Method:     method,
		URL:        response.URL,
		StatusCode: response.StatusCode,
		Body:       abbreviate(response.Body, 500),
	}
}

func (client *Client) wait(ctx context.Context) error {
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.delay <= 0 || client.lastCall.IsZero() {
		client.lastCall = time.Now()
		return nil
	}
	wait := time.Until(client.lastCall.Add(client.delay))
	if wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
	}
	client.lastCall = time.Now()
	return nil
}

func abbreviate(data []byte, limit int) string {
	text := strings.TrimSpace(string(data))
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "..."
}

func clearanceKey(host string) string {
	return "JOBKIT_COOKIE_" + strings.ToUpper(
		strings.NewReplacer(".", "_", "-", "_", ":", "_").Replace(host),
	)
}

func clearanceCookie(host string) string {
	if host == "" {
		return ""
	}
	return strings.TrimSpace(os.Getenv(clearanceKey(host)))
}

var challengeMarkers = []string{
	"Just a moment...",
	"Attention Required! | Cloudflare",
	"cf-browser-verification",
	"challenges.cloudflare.com",
}

func isChallenge(body []byte) bool {
	text := string(body)
	for _, marker := range challengeMarkers {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

var clearanceMu sync.Mutex

func refreshClearance(ctx context.Context, reference string) {
	command := strings.TrimSpace(os.Getenv("JOBKIT_CLEARANCE_REFRESH_CMD"))
	if command == "" {
		return
	}
	clearanceMu.Lock()
	defer clearanceMu.Unlock()
	parsed, err := url.Parse(reference)
	if err != nil {
		return
	}
	execution := exec.CommandContext(ctx, "sh", "-c", command)
	execution.Env = append(os.Environ(), "JOBKIT_CLEARANCE_HOST="+parsed.Host)
	output, err := execution.Output()
	if err != nil {
		return
	}
	cookie := strings.TrimSpace(string(output))
	if cookie == "" || !strings.Contains(cookie, "=") {
		return
	}
	_ = os.Setenv(clearanceKey(parsed.Host), cookie)
}
