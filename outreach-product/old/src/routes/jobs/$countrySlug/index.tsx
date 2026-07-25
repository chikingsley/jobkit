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

export const Route = createFileRoute("/jobs/$countrySlug/")({
  component: PublicCountryJobsPage,
  head: ({ loaderData, params }) =>
    publicJobListHead(loaderData, `/jobs/${params.countrySlug}`),
  loader: ({ deps, params }) =>
    getPublicJobList({
      data: {
        market: { countrySlug: params.countrySlug },
        search: publicJobsSearchSchema.parse(deps),
      },
    }),
  loaderDeps: ({ search }) => publicJobsSearchSchema.parse(search),
  validateSearch: publicJobsSearchSchema,
});

function PublicCountryJobsPage() {
  const result = Route.useLoaderData() as PublicJobListResult | undefined;
  const { countrySlug } = Route.useParams();
  const basePath = `/jobs/${countrySlug}`;
  return result?.kind === "success" ? (
    <PublicJobListPage basePath={basePath} response={result.data} />
  ) : (
    <PublicJobListErrorPage
      basePath={basePath}
      stale={result?.kind === "stale_cursor"}
    />
  );
}
