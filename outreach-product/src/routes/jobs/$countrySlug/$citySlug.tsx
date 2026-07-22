import { createFileRoute } from "@tanstack/react-router";
import {
  PublicJobListErrorPage,
  PublicJobListPage,
} from "@/features/public/job-list-page";
import { publicJobsSearchSchema } from "@/features/public/job-search";
import { getPublicJobList } from "@/features/public/jobs.functions";

export const Route = createFileRoute("/jobs/$countrySlug/$citySlug")({
  component: PublicCityJobsPage,
  loader: ({ deps, params }) =>
    getPublicJobList({
      data: {
        market: {
          citySlug: params.citySlug,
          countrySlug: params.countrySlug,
        },
        search: publicJobsSearchSchema.parse(deps),
      },
    }),
  loaderDeps: ({ search }) => publicJobsSearchSchema.parse(search),
  validateSearch: publicJobsSearchSchema,
});

function PublicCityJobsPage() {
  const result = Route.useLoaderData();
  const { citySlug, countrySlug } = Route.useParams();
  const basePath = `/jobs/${countrySlug}/${citySlug}`;
  return result.kind === "success" ? (
    <PublicJobListPage basePath={basePath} response={result.data} />
  ) : (
    <PublicJobListErrorPage
      basePath={basePath}
      stale={result.kind === "stale_cursor"}
    />
  );
}
