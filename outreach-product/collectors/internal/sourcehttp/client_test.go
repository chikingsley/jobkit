package sourcehttp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestGetSendsClearanceCookieForTheHost(t *testing.T) {
	var seen string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		seen = request.Header.Get("Cookie")
		_, _ = writer.Write([]byte("ok"))
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "http://")
	t.Setenv(clearanceKey(host), "cf_clearance=proof")
	client, err := New(server.URL, server.Client(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Get(context.Background(), "/", "text/html"); err != nil {
		t.Fatal(err)
	}
	if seen != "cf_clearance=proof" {
		t.Fatalf("cookie sent = %q", seen)
	}
}

func TestGetRefreshesClearanceOnAChallengeAndRetries(t *testing.T) {
	attempts := 0
	var cookies []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempts++
		cookies = append(cookies, request.Header.Get("Cookie"))
		if attempts == 1 {
			writer.WriteHeader(http.StatusForbidden)
			_, _ = writer.Write([]byte("<title>Just a moment...</title>"))
			return
		}
		_, _ = writer.Write([]byte("ok"))
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "http://")
	t.Setenv(clearanceKey(host), "cf_clearance=stale")
	t.Setenv("JOBKIT_CLEARANCE_REFRESH_CMD", "printf cf_clearance=fresh")
	client, err := New(server.URL, server.Client(), 0)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Get(context.Background(), "/", "text/html")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || attempts != 2 {
		t.Fatalf("status=%d attempts=%d", response.StatusCode, attempts)
	}
	if cookies[0] != "cf_clearance=stale" || cookies[1] != "cf_clearance=fresh" {
		t.Fatalf("cookies = %#v", cookies)
	}
	if os.Getenv(clearanceKey(host)) != "cf_clearance=fresh" {
		t.Fatal("refreshed clearance was not stored for later requests")
	}
}

func TestRequestSkipsTheCookieHeaderWhenNoClearanceIsSet(t *testing.T) {
	var present bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, present = request.Header["Cookie"]
		_, _ = writer.Write([]byte("ok"))
	}))
	t.Cleanup(server.Close)
	client, err := New(server.URL, server.Client(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Get(context.Background(), "/", "text/html"); err != nil {
		t.Fatal(err)
	}
	if present {
		t.Fatal("sent a Cookie header with no clearance configured")
	}
}
