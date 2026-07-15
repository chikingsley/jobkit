import { CircleAlert, LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApplicationRoute, Job } from "@/features/jobs/types";

const retryableDraftStatuses = new Set(["approved", "draft"]);
const retryableJobStatuses = new Set(["approved", "failed", "review"]);
const pendingEmailStatuses = new Set([
  "approved",
  "claimed",
  "drafted",
  "sending",
]);

function activeEmailRoute(job: Job): ApplicationRoute | undefined {
  return job.applicationRoutes.find(
    (route) => route.kind === "email" && route.status === "active"
  );
}

function emailActionLabel(job: Job) {
  const attempt = job.emailAttempt;
  if (attempt?.status === "sent") {
    return "Application sent";
  }
  if (attempt?.status === "uncertain") {
    return "Check send status";
  }
  if (attempt?.sendRequestedAt && pendingEmailStatuses.has(attempt.status)) {
    return "Sending…";
  }
  if (attempt?.status === "failed") {
    return "Try send again";
  }
  return "Send application";
}

function emailActionIcon(pending: boolean, uncertain: boolean) {
  if (pending) {
    return <LoaderCircle className="animate-spin" />;
  }
  if (uncertain) {
    return <CircleAlert />;
  }
  return <Send />;
}

function boardActionLabel(isSending: boolean, sent: boolean) {
  if (isSending) {
    return "Sending…";
  }
  return sent ? "Application sent" : "Send application";
}

function EmailApplicationAction({
  busy,
  job,
  onAction,
  route,
}: {
  busy: string;
  job: Job;
  onAction: (path: string, body?: object) => Promise<void>;
  route: ApplicationRoute;
}) {
  const path = `/api/jobs/${job.id}/email-send-requests`;
  const attempt = job.emailAttempt;
  const pending = Boolean(
    attempt?.sendRequestedAt && pendingEmailStatuses.has(attempt.status)
  );
  const terminal =
    attempt?.status === "sent" || attempt?.status === "uncertain";
  const uncertain = attempt?.status === "uncertain";
  const canSend =
    job.draft !== null &&
    retryableDraftStatuses.has(job.draft.status) &&
    !pending &&
    !terminal;

  return (
    <Button
      disabled={!canSend || Boolean(busy)}
      onClick={() =>
        void onAction(path, {
          draftId: job.draft?.id,
          routeId: route.id,
        })
      }
      variant={uncertain ? "destructive" : "default"}
    >
      {emailActionIcon(pending, uncertain)}
      {emailActionLabel(job)}
    </Button>
  );
}

function BoardApplicationAction({
  busy,
  job,
  onAction,
}: {
  busy: string;
  job: Job;
  onAction: (path: string, body?: object) => Promise<void>;
}) {
  const submitPath = `/api/jobs/${job.id}/submit`;
  const isSending = busy === submitPath || job.status === "submitting";
  const sent = job.status === "applied" || job.draft?.status === "submitted";
  const canSubmit =
    job.draft !== null &&
    retryableDraftStatuses.has(job.draft.status) &&
    retryableJobStatuses.has(job.status);

  return (
    <Button
      disabled={!canSubmit || Boolean(busy)}
      onClick={() => void onAction(submitPath, { draftId: job.draft?.id })}
    >
      {isSending ? <LoaderCircle className="animate-spin" /> : <Send />}
      {boardActionLabel(isSending, sent)}
    </Button>
  );
}

export function ApplicationAction({
  busy,
  job,
  onAction,
}: {
  busy: string;
  job: Job;
  onAction: (path: string, body?: object) => Promise<void>;
}) {
  const emailRoute = activeEmailRoute(job);
  return emailRoute ? (
    <EmailApplicationAction
      busy={busy}
      job={job}
      onAction={onAction}
      route={emailRoute}
    />
  ) : (
    <BoardApplicationAction busy={busy} job={job} onAction={onAction} />
  );
}
