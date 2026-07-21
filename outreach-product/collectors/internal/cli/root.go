package cli

import (
	"context"

	"github.com/spf13/cobra"
)

// Execute runs the JobKit collector command tree.
func Execute() error {
	return newRootCommand().ExecuteContext(context.Background())
}

func newRootCommand() *cobra.Command {
	command := &cobra.Command{
		Use:           "jobkit-collect",
		Short:         "Collect source-complete job inventory for JobKit",
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	command.AddCommand(newRefreshCommand())
	command.AddCommand(newRunsCommand())
	command.AddCommand(newJobsCommand())
	return command
}
