package cli

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/boards/ajarn"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/boards/anesl"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/boards/eslcafe"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/boards/seriousteachers"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/boards/tefl"
	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/inventory"
)

var sourceOrigins = map[string]string{
	"ajarn":           "https://www.ajarn.com",
	"anesl":           "https://cafe.anesl.com",
	"eslcafe-modern":  "https://www.eslcafe.com",
	"seriousteachers": "https://www.seriousteachers.com",
	"tefl":            "https://www.tefl.com",
}

type sourceOptions struct {
	name            string
	baseURL         string
	requestInterval time.Duration
	eslcafeSections []string
}

func buildSource(options sourceOptions) (inventory.Source, error) {
	name := normalizeSourceName(options.name)
	origin, exists := sourceOrigins[name]
	if !exists {
		return nil, fmt.Errorf(
			"unsupported source %q; expected ajarn, anesl, eslcafe, seriousteachers, or tefl",
			options.name,
		)
	}
	if override := strings.TrimSpace(options.baseURL); override != "" {
		origin = override
	}
	httpClient, err := newHTTPClient()
	if err != nil {
		return nil, err
	}
	switch name {
	case "ajarn":
		return ajarn.NewClient(origin, httpClient, options.requestInterval)
	case "anesl":
		return anesl.NewClient(origin, httpClient, options.requestInterval)
	case "eslcafe-modern":
		sections, err := eslcafe.NormalizeBoards(options.eslcafeSections)
		if err != nil {
			return nil, err
		}
		return eslcafe.NewClient(origin, httpClient, options.requestInterval, sections...)
	case "seriousteachers":
		return seriousteachers.NewClient(
			origin,
			httpClient,
			options.requestInterval,
			seriousteachers.Credentials{
				Email:    strings.TrimSpace(os.Getenv("SERIOUSTEACHERS_EMAIL")),
				Password: os.Getenv("SERIOUSTEACHERS_PASSWORD"),
			},
		)
	case "tefl":
		return tefl.NewClient(origin, httpClient, options.requestInterval)
	default:
		return nil, fmt.Errorf("source %q is not implemented", name)
	}
}

func normalizeSourceName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "eslcafe", "esl-cafe", "eslcafe-modern":
		return "eslcafe-modern"
	default:
		return value
	}
}
