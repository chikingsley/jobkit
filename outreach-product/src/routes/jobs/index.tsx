import { createFileRoute } from "@tanstack/react-router";
import { foundationHead } from "@/features/public/foundation-page";
import {
  PublicJobListErrorPage,
  PublicJobListPage,
} from "@/features/public/job-list-page";
import { publicJobsSearchSchema } from "@/features/public/job-search";
import { getPublicJobList } from "@/features/public/jobs.functions";

export const Route = createFileRoute("/jobs/")({
  component: PublicJobsPage,
  head: () =>
    foundationHead(
      "Teaching jobs | JobKit",
      "JobKit's public job catalog is being prepared from verified inventory."
    ),
  loader: ({ deps }) =>
    getPublicJobList({ data: { search: publicJobsSearchSchema.parse(deps) } }),
  loaderDeps: ({ search }) => publicJobsSearchSchema.parse(search),
  validateSearch: publicJobsSearchSchema,
});

function PublicJobsPage() {
  const result = Route.useLoaderData();
  return result.kind === "success" ? (
    <PublicJobListPage basePath="/jobs" response={result.data} />
  ) : (
    <PublicJobListErrorPage
      basePath="/jobs"
      stale={result.kind === "stale_cursor"}
    />
  );
}
