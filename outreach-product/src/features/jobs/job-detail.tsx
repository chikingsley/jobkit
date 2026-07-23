import { Banknote, BriefcaseBusiness, Gift } from "lucide-react";
import type { ComponentType } from "react";
import { ApplicationAction } from "@/features/jobs/application-action";
import { ApplicationDelivery } from "@/features/jobs/application-delivery";
import { createJobDisplayFacts } from "@/features/jobs/display-facts";
import { DraftEditor } from "@/features/jobs/draft-editor";
import { humanize } from "@/features/jobs/format";
import { JobLocation } from "@/features/jobs/job-location";
import { MatchPanel } from "@/features/jobs/match";
import { NormalizedJobDescription } from "@/features/jobs/normalized-description";
import { PositionAnalysis } from "@/features/jobs/position-analysis";
import type { DraftMutationResult, FxData, Job } from "@/features/jobs/types";
import type { QualificationClaimAnswer } from "@/features/matching/claims";
import type { JobMatch } from "@/profile-types";

function deliveryStatus(job: Job) {
  const attempt = job.emailAttempt;
  if (
    attempt?.sendRequestedAt &&
    ["approved", "claimed", "drafted", "sending"].includes(attempt.status)
  ) {
    return "sending";
  }
  if (attempt) {
    return attempt.status;
  }
  return job.draft ? job.draft.status : "not generated";
}

function ApplicationSection({
  busy,
  instruction,
  job,
  onAction,
  onDraftAction,
  onInstruction,
}: {
  busy: string;
  instruction: string;
  job: Job;
  onAction: (path: string, body?: object) => Promise<void>;
  onDraftAction: (
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ) => Promise<DraftMutationResult | null>;
  onInstruction: (value: string) => void;
}) {
  const hasEmailRoute = job.applicationRoutes.some(
    (route) => route.kind === "email"
  );
  if (!job.draft) {
    return (
      <section className="mt-7 flex justify-end border-t pt-6">
        <ApplicationAction busy={busy} job={job} onAction={onAction} />
      </section>
    );
  }

  return (
    <section className="mt-7 border-t pt-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-semibold">Application message</h3>
        <span className="text-muted-foreground text-xs">
          {humanize(deliveryStatus(job))}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-4">
        {hasEmailRoute ? <ApplicationDelivery job={job} /> : null}
        <DraftEditor
          busy={
            Boolean(busy) ||
            deliveryStatus(job) === "sending" ||
            job.draftTask?.status === "queued" ||
            job.draftTask?.status === "claimed"
          }
          draft={job.draft}
          instruction={instruction}
          onDraftAction={onDraftAction}
          onInstruction={onInstruction}
          resourcePath={`/api/jobs/${job.id}`}
        />
        <div className="flex justify-end pt-1">
          <ApplicationAction busy={busy} job={job} onAction={onAction} />
        </div>
      </div>
    </section>
  );
}

export function JobDetail({
  busy,
  busyClaimKey,
  fx,
  instruction,
  job,
  match,
  onAction,
  onDraftAction,
  onInstruction,
  onQualificationClaim,
}: {
  busy: string;
  busyClaimKey: string;
  fx: FxData;
  instruction: string;
  job: Job;
  match?: JobMatch;
  onAction: (path: string, body?: object) => Promise<void>;
  onDraftAction: (
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ) => Promise<DraftMutationResult | null>;
  onInstruction: (value: string) => void;
  onQualificationClaim: (input: {
    answer: QualificationClaimAnswer | null;
    claimKey: string;
    kind: string;
    label: string;
  }) => Promise<void>;
}) {
  const facts = createJobDisplayFacts(job, fx, match);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-6">
      <header className="min-w-0">
        <h2 className="text-balance font-semibold text-2xl tracking-tight">
          {job.title}
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">{facts.employer}</p>
      </header>

      {facts.compensationWarning ? (
        <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          {facts.compensationWarning}
        </p>
      ) : null}

      <JobDetails facts={facts} job={job} />

      {match ? (
        <MatchPanel
          busyClaimKey={busyClaimKey}
          match={match}
          onQualificationClaim={onQualificationClaim}
          summary={facts.matchSummary}
        />
      ) : null}

      {job.positionAnalysis ? (
        <PositionAnalysis analysis={job.positionAnalysis} />
      ) : null}

      <section className="mt-5 border-t pt-4 text-sm">
        <h3 className="font-semibold">Full job description</h3>
        <NormalizedJobDescription
          analysis={
            job.analysisStatus.content === "current"
              ? job.contentAnalysis
              : null
          }
          description={job.description}
          routes={job.applicationRoutes}
        />
      </section>

      <ApplicationSection
        busy={busy}
        instruction={instruction}
        job={job}
        onAction={onAction}
        onDraftAction={onDraftAction}
        onInstruction={onInstruction}
      />
    </div>
  );
}

function JobDetails({
  facts,
  job,
}: {
  facts: ReturnType<typeof createJobDisplayFacts>;
  job: Job;
}) {
  const employment = job.matchFacts?.employmentTypes
    .map((item) => humanize(item.value))
    .join(", ");
  const benefits = job.matchFacts?.benefits
    .map((item) => `${humanize(item.value)} ${item.level}`)
    .join(", ");
  const items: Array<{
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
  }> = [
    {
      icon: Banknote,
      label: "Compensation",
      value: [facts.compensationPrimary, ...facts.compensationSecondary].join(
        " · "
      ),
    },
  ];
  if (employment) {
    items.push({
      icon: BriefcaseBusiness,
      label: "Employment",
      value: employment,
    });
  }
  if (benefits) {
    items.push({ icon: Gift, label: "Benefits", value: benefits });
  }
  return (
    <section className="mt-6">
      <h3 className="font-semibold">Job details</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            className="flex min-h-20 gap-3 rounded-xl bg-muted/35 p-3 ring-1 ring-foreground/10"
            key={item.label}
          >
            <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <dt className="font-medium text-muted-foreground text-xs">
                {item.label}
              </dt>
              <dd className="mt-1 text-sm leading-5">{item.value}</dd>
            </div>
          </div>
        ))}
        <JobLocation
          jobId={job.id}
          label={facts.location}
          location={job.resolvedLocations[0]}
        />
      </dl>
    </section>
  );
}
