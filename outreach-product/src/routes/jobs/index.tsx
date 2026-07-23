import { createFileRoute } from "@tanstack/react-router";
import {
  PublicJobListErrorPage,
  PublicJobListPage,
} from "@/features/public/job-list-page";
import { publicJobsSearchSchema } from "@/features/public/job-search";
import {
  getPublicJobList,
  type PublicJobListResult,
} from "@/features/public/jobs.functions";
import { publicJobListHead } from "@/features/public/seo";

export const Route = createFileRoute("/jobs/")({
  component: PublicJobsPage,
  head: ({ loaderData }) => publicJobListHead(loaderData, "/jobs"),
  loader: ({ deps }) =>
    getPublicJobList({ data: { search: publicJobsSearchSchema.parse(deps) } }),
  loaderDeps: ({ search }) => publicJobsSearchSchema.parse(search),
  validateSearch: publicJobsSearchSchema,
});

function PublicJobsPage() {
  const result = Route.useLoaderData() as PublicJobListResult | undefined;
  return result?.kind === "success" ? (
    <PublicJobListPage basePath="/jobs" response={result.data} />
  ) : (
    <PublicJobListErrorPage
      basePath="/jobs"
      stale={result?.kind === "stale_cursor"}
    />
  );
}
