import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  foundationHead,
  PublicFoundationPage,
} from "@/features/public/foundation-page";
import { jobsSearchSchema } from "@/features/workspace/search";

export const Route = createFileRoute("/")({
  beforeLoad: ({ search }) => {
    const hasLegacyWorkspaceState =
      Boolean(search.job) ||
      search.country !== undefined ||
      search.fit !== undefined ||
      search.sort !== undefined ||
      search.detail !== undefined ||
      search.excluded !== undefined;
    if (hasLegacyWorkspaceState) {
      throw redirect({ search, to: "/app/jobs" });
    }
  },
  component: HomePage,
  head: () =>
    foundationHead(
      "JobKit",
      "Teaching opportunities, evidence-backed matching, and application tracking."
    ),
  validateSearch: jobsSearchSchema,
});

function HomePage() {
  return (
    <PublicFoundationPage title="Find teaching work with a clear application trail">
      JobKit is preparing its public opportunity catalog. The signed-in
      workspace remains available for private job review, campaigns, and
      messages.
    </PublicFoundationPage>
  );
}
