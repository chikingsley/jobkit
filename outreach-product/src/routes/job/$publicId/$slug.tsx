import { createFileRoute } from "@tanstack/react-router";
import {
  PublicGoneJobPage,
  PublicJobDetailPage,
} from "@/features/public/job-detail-page";
import { getPublicJobDetail } from "@/features/public/jobs.functions";

export const Route = createFileRoute("/job/$publicId/$slug")({
  component: PublicJobPage,
  head: () => ({
    meta: [
      { title: "Teaching job | JobKit" },
      { content: "noindex,follow", name: "robots" },
    ],
  }),
  loader: ({ params }) => getPublicJobDetail({ data: params }),
});

function PublicJobPage() {
  const result = Route.useLoaderData();
  return result.kind === "success" ? (
    <PublicJobDetailPage job={result.data} />
  ) : (
    <PublicGoneJobPage />
  );
}
