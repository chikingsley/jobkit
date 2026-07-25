import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  MapPin,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { PublicJobDetailResponse } from "../../../worker/public-jobs/schemas";
import {
  publicJobCompensation,
  publicJobEmployment,
  publicJobHourlyUsd,
  publicJobLocation,
  publicJobPosted,
  publicJobSourceLabel,
} from "./job-format";
import { PublicPageMain, PublicSiteShell } from "./site-shell";

export function PublicJobDetailPage({ job }: { job: PublicJobDetailResponse }) {
  const hourly = publicJobHourlyUsd(job);
  const posted = publicJobPosted(job);
  const source = publicJobSourceLabel(job);
  return (
    <PublicSiteShell>
      <PublicPageMain className="max-w-5xl">
        <Link
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg pr-3 text-muted-foreground text-sm hover:text-foreground"
          to="/jobs"
        >
          <ArrowLeft className="size-4" /> Jobs
        </Link>
        <article className="mt-5">
          <header className="max-w-4xl">
            <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
              {job.title}
            </h1>
            <p className="mt-2 text-lg text-muted-foreground">
              {job.organization.name}
            </p>
          </header>

          {job.status === "closed" ? (
            <p className="mt-6 border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
              This position has closed. Its published details remain available
              for reference.
            </p>
          ) : null}

          <section aria-labelledby="job-details-heading" className="mt-8">
            <h2 className="font-semibold text-lg" id="job-details-heading">
              Job details
            </h2>
            <dl className="mt-4 grid gap-x-10 gap-y-5 sm:grid-cols-2">
              <DetailFact
                icon={<Banknote />}
                label="Compensation"
                value={publicJobCompensation(job)}
              />
              {hourly ? (
                <DetailFact
                  icon={<Banknote />}
                  label="Hourly USD"
                  value={hourly}
                />
              ) : null}
              <DetailFact
                icon={<MapPin />}
                label="Location"
                value={publicJobLocation(job)}
              />
              <DetailFact
                icon={<BriefcaseBusiness />}
                label="Employment"
                value={publicJobEmployment(job)}
              />
              {posted ? (
                <DetailFact
                  icon={<CalendarDays />}
                  label="Posted"
                  value={posted}
                />
              ) : null}
              {source ? (
                <DetailFact
                  icon={<BriefcaseBusiness />}
                  label="Source"
                  value={source}
                />
              ) : null}
            </dl>
          </section>

          <section aria-labelledby="description-heading" className="mt-10">
            <h2 className="font-semibold text-lg" id="description-heading">
              Full job description
            </h2>
            <div
              className="mt-4 max-w-[76ch] space-y-6 text-foreground/90 text-sm leading-7 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-base [&_li]:mb-1.5 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: immutable public detail HTML has already passed the shared strict element, attribute, and contact-value sanitizer.
              dangerouslySetInnerHTML={{ __html: job.descriptionHtml }}
            />
          </section>

          {job.application.available ? (
            <section className="mt-10 flex border-t pt-6">
              <Button
                render={
                  <Link search={{ publicJob: job.publicId }} to="/app/jobs" />
                }
                size="lg"
              >
                Apply with JobKit
              </Button>
            </section>
          ) : null}
        </article>
      </PublicPageMain>
    </PublicSiteShell>
  );
}

export function PublicGoneJobPage() {
  return (
    <PublicSiteShell>
      <PublicPageMain className="grid min-h-[calc(100svh-8rem)] max-w-4xl content-center">
        <h1 className="font-semibold text-3xl tracking-tight">
          This job has been removed
        </h1>
        <p className="mt-2 max-w-xl text-muted-foreground leading-7">
          JobKit has a permanent removal record for this position. Browse the
          current catalog for active opportunities.
        </p>
        <Button className="mt-6 w-fit" render={<Link to="/jobs" />} size="lg">
          Browse jobs
        </Button>
      </PublicPageMain>
    </PublicSiteShell>
  );
}

function DetailFact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 gap-3">
      <div className="mt-0.5 size-4 shrink-0 text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div className="min-w-0">
        <dt className="font-medium text-muted-foreground text-xs">{label}</dt>
        <dd className="mt-1 text-sm leading-5">{value}</dd>
      </div>
    </div>
  );
}
