package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chikingsley/jobkit/outreach-product/collectors/internal/boards/seriousteachers"
	"github.com/spf13/cobra"
)

type applyRequest struct {
	Comments   string `json:"comments"`
	EmployerID string `json:"employerId"`
	JobID      string `json:"jobId"`
}

type applyResponse struct {
	Detail string `json:"detail,omitempty"`
	Status string `json:"status"`
	URL    string `json:"url,omitempty"`
}

func newServeCommand() *cobra.Command {
	var address string
	var requestInterval time.Duration
	command := &cobra.Command{
		Use:   "serve",
		Short: "Serve an apply endpoint over HTTP for the pipeline to call",
		RunE: func(command *cobra.Command, _ []string) error {
			httpClient, err := newHTTPClient()
			if err != nil {
				return err
			}
			client, err := seriousteachers.NewClient(
				"https://www.seriousteachers.com",
				httpClient,
				requestInterval,
				seriousteachers.Credentials{
					Email:    strings.TrimSpace(os.Getenv("SERIOUSTEACHERS_EMAIL")),
					Password: os.Getenv("SERIOUSTEACHERS_PASSWORD"),
				},
			)
			if err != nil {
				return err
			}
			mux := http.NewServeMux()
			mux.HandleFunc("POST /apply/seriousteachers", func(writer http.ResponseWriter, reader *http.Request) {
				var request applyRequest
				if decodeErr := json.NewDecoder(reader.Body).Decode(&request); decodeErr != nil {
					writeAPIJSON(writer, http.StatusBadRequest, applyResponse{Detail: decodeErr.Error(), Status: "failed"})
					return
				}
				if request.JobID == "" || request.EmployerID == "" {
					writeAPIJSON(writer, http.StatusBadRequest, applyResponse{Detail: "jobId and employerId are required", Status: "failed"})
					return
				}
				ctx, cancel := context.WithTimeout(reader.Context(), 3*time.Minute)
				defer cancel()
				outcome, applyErr := client.Respond(ctx, request.JobID, request.EmployerID, request.Comments)
				if applyErr != nil {
					writeAPIJSON(writer, http.StatusBadGateway, applyResponse{Detail: applyErr.Error(), Status: "failed"})
					return
				}
				writeAPIJSON(writer, http.StatusOK, applyResponse{Detail: outcome.Detail, Status: outcome.Status, URL: outcome.URL})
			})
			mux.HandleFunc("GET /health", func(writer http.ResponseWriter, _ *http.Request) {
				writeAPIJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
			})
			fmt.Fprintf(command.OutOrStdout(), "apply endpoint listening on %s\n", address)
			return http.ListenAndServe(address, mux)
		},
	}
	command.Flags().StringVar(&address, "address", "127.0.0.1:8787", "listen address")
	command.Flags().DurationVar(&requestInterval, "request-interval", time.Second, "minimum interval between source requests")
	return command
}

func writeAPIJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("content-type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}
