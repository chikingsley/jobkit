import { createFileRoute } from "@tanstack/react-router";
import { JobsRoute } from "@/features/jobs/route";
import { jobsSearchSchema } from "@/features/workspace/search";

export const Route = createFileRoute("/app/jobs")({
  component: JobsRoute,
  validateSearch: jobsSearchSchema,
});
