import { createFileRoute, redirect } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { foundationHead } from "@/features/public/foundation-page";
import {
  PublicPageHeading,
  PublicPageMain,
  PublicSiteShell,
} from "@/features/public/site-shell";
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
      "Browse international teaching jobs, review normalized requirements, and continue into a tracked application workspace.",
      "/"
    ),
  validateSearch: jobsSearchSchema,
});

function HomePage() {
  return (
    <PublicSiteShell>
      <PublicPageMain className="grid min-h-[calc(100svh-3.5rem)] content-center py-16">
        <PublicPageHeading
          description="Browse current teaching opportunities, compare the facts that matter, and carry one selected role into a private application workspace."
          title="Find teaching work with a clear application trail"
        />
        <div className="mt-7 flex flex-wrap gap-3">
          <Button render={<a href="/jobs" />} size="lg">
            Browse teaching jobs <ArrowRight />
          </Button>
          <Button
            render={<a href="/app/campaigns" />}
            size="lg"
            variant="outline"
          >
            Open campaigns
          </Button>
        </div>
        <dl className="mt-12 grid max-w-4xl gap-6 border-y py-7 sm:grid-cols-3">
          <Value
            description="One canonical position, organization, and Mapbox-backed location."
            title="Clear records"
          />
          <Value
            description="Readable descriptions preserve the verified facts from each source."
            title="Normalized details"
          />
          <Value
            description="Private drafts, documents, recipients, sends, and replies stay inside your workspace."
            title="Private execution"
          />
        </dl>
      </PublicPageMain>
    </PublicSiteShell>
  );
}

function Value({ description, title }: { description: string; title: string }) {
  return (
    <div>
      <dt className="font-semibold">{title}</dt>
      <dd className="mt-1 text-muted-foreground text-sm leading-6">
        {description}
      </dd>
    </div>
  );
}
