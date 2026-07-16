import {
  AlertTriangle,
  Check,
  CircleHelp,
  ExternalLink,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { curatedJobs, eligibilityNotes } from "@/curated-jobs";
import { ApplicationAction } from "@/features/jobs/application-action";
import { ApplicationDelivery } from "@/features/jobs/application-delivery";
import { compensationDisplay } from "@/features/jobs/compensation";
import { formatDescription, questionsFor } from "@/features/jobs/content";
import {
  formatStatedHourlyUsd,
  housingLabel,
  listedHourlyValueUsd,
  statedHourlyValueUsd,
} from "@/features/jobs/economics";
import { humanize } from "@/features/jobs/format";
import { JobMarketContext } from "@/features/jobs/market-context";
import { MatchPanel } from "@/features/jobs/match";
import type { FxData, Job } from "@/features/jobs/types";
import type { QualificationClaimAnswer } from "@/features/matching/claims";
import type { JobMatch } from "@/profile-types";

const boardLabels: Record<string, string> = {
  "eslcafe-modern": "ESL Cafe",
  seriousteachers: "Serious Teachers",
};

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

export function JobDetail({
  busy,
  busyClaimKey,
  fx,
  instruction,
  job,
  match,
  onAction,
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
  onInstruction: (value: string) => void;
  onQualificationClaim: (input: {
    answer: QualificationClaimAnswer | null;
    claimKey: string;
    kind: string;
    label: string;
  }) => Promise<void>;
}) {
  const sections = curatedJobs[job.id] ?? [];
  const salary = compensationDisplay(job.compensation, fx);
  const hourly =
    (job.matchFacts
      ? statedHourlyValueUsd(job.matchFacts.economics, fx)
      : null) ?? listedHourlyValueUsd(job.compensation, fx);
  const housing = housingLabel(
    job.matchFacts?.benefits ?? [],
    job.matchFacts?.economics
  );
  const questions = questionsFor(job, sections);
  const eligibility = eligibilityNotes[job.id] ?? [];
  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-primary text-xs">{job.country}</p>
          <h2 className="mt-1 text-balance font-semibold text-2xl tracking-tight sm:text-3xl">
            {job.title}
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            {job.company || "Employer not named"}
            {job.location ? ` · ${job.location}` : ""}
          </p>
        </div>
        <Button
          render={
            <a
              href={job.sourceUrl || job.applyUrl}
              rel="noreferrer"
              target="_blank"
            />
          }
          variant="outline"
        >
          View original
          <ExternalLink />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 py-4">
        <Badge variant="secondary">{salary.primary}</Badge>
        {salary.usd ? <Badge variant="outline">{salary.usd}</Badge> : null}
        {hourly ? (
          <Badge variant="outline">{formatStatedHourlyUsd(hourly)}</Badge>
        ) : null}
        {housing ? <Badge variant="outline">{housing}</Badge> : null}
        <Badge variant="outline">
          {boardLabels[job.board] ?? humanize(job.board)}
        </Badge>
        <Badge variant="outline">Draft v{job.draft?.version}</Badge>
      </div>

      <JobMarketContext job={job} />

      {match ? (
        <MatchPanel
          busyClaimKey={busyClaimKey}
          match={match}
          onQualificationClaim={onQualificationClaim}
        />
      ) : null}

      {eligibility.length ? (
        <Card className="mt-5 border-amber-500/25 bg-amber-500/[0.04] ring-amber-500/20">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-amber-900 text-sm dark:text-amber-200">
              <AlertTriangle className="size-4" />
              Check before applying
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-foreground/80 text-sm">
              {eligibility.map((note) => (
                <li className="flex gap-2" key={note}>
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-amber-500" />
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {salary.warning ? (
        <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          {salary.warning}
        </p>
      ) : null}

      {job.compensation.notes.length ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Compensation details</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-foreground/80 text-sm leading-6">
              {job.compensation.notes.map((note) => (
                <li className="flex gap-2.5" key={note}>
                  <Check className="mt-1.5 size-3.5 shrink-0 text-primary" />
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5 text-foreground/80 text-sm leading-6">
                {section.items.map((item) => (
                  <li className="flex gap-2.5" key={item}>
                    <Check className="mt-1.5 size-3.5 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Open questions</CardTitle>
          <CardDescription>
            Details worth confirming with the employer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5 text-foreground/80 text-sm leading-6">
            {questions.map((question) => (
              <li className="flex gap-2.5" key={question}>
                <CircleHelp className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" />
                {question}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <details className="mt-4 rounded-xl border bg-background px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Full original job description
        </summary>
        <p className="mt-4 whitespace-pre-line text-muted-foreground leading-7">
          {formatDescription(job.description) || "No description was imported."}
        </p>
      </details>

      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                Application message
              </CardTitle>
              <CardDescription className="mt-1">
                Review the exact message that will be submitted.
              </CardDescription>
            </div>
            <Badge
              variant={
                job.draft?.status === "approved" ? "default" : "secondary"
              }
            >
              {humanize(deliveryStatus(job))}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ApplicationDelivery job={job} />
          <Textarea
            aria-label="Tailored application message"
            className="min-h-72 resize-y bg-background leading-7"
            readOnly
            value={job.draft?.message}
          />
          {job.draft?.changeSummary ? (
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <div className="font-medium">What was tailored</div>
              <p className="mt-1 text-muted-foreground">
                {job.draft.changeSummary}
              </p>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Textarea
              className="min-h-20 flex-1"
              onChange={(event) => onInstruction(event.target.value)}
              placeholder="Describe one change, for example: Ask only about the schedule and start date."
              value={instruction}
            />
            <Button
              className="self-end"
              disabled={
                !instruction ||
                Boolean(busy) ||
                deliveryStatus(job) === "sending"
              }
              onClick={() =>
                void onAction(`/api/jobs/${job.id}/revise`, { instruction })
              }
              variant="secondary"
            >
              Revise message
            </Button>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <ApplicationAction busy={busy} job={job} onAction={onAction} />
        </CardFooter>
      </Card>
    </div>
  );
}
