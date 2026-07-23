import { createFileRoute } from "@tanstack/react-router";
import {
  PublicGoneJobPage,
  PublicJobDetailPage,
} from "@/features/public/job-detail-page";
import {
  getPublicJobDetail,
  type PublicJobDetailResult,
} from "@/features/public/jobs.functions";
import { publicJobDetailHead } from "@/features/public/seo";

export const Route = createFileRoute("/job/$publicId/$slug")({
  component: PublicJobPage,
  head: ({ loaderData, params }) =>
    publicJobDetailHead(loaderData, `/job/${params.publicId}/${params.slug}`),
  loader: ({ params }) => getPublicJobDetail({ data: params }),
});

function PublicJobPage() {
  const result = Route.useLoaderData() as PublicJobDetailResult | undefined;
  return result?.kind === "success" ? (
    <PublicJobDetailPage job={result.data} />
  ) : (
    <PublicGoneJobPage />
  );
}
