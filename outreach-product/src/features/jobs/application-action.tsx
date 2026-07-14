import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Job } from "@/features/jobs/types";

const retryableDraftStatuses = new Set(["approved", "draft"]);
const retryableJobStatuses = new Set(["approved", "failed", "review"]);

function actionLabel(job: Job, isSending: boolean) {
  if (isSending) {
    return "Sending…";
  }
  if (job.status === "failed") {
    return "Retry send";
  }
  if (job.status === "applied" || job.draft?.status === "submitted") {
    return "Application sent";
  }
  return "Approve and send";
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
  const submitPath = `/api/jobs/${job.id}/submit`;
  const isSending = busy === submitPath || job.status === "submitting";
  const canSubmit =
    job.draft !== null &&
    retryableDraftStatuses.has(job.draft.status) &&
    retryableJobStatuses.has(job.status);

  return (
    <Button
      disabled={!canSubmit || Boolean(busy)}
      onClick={() => void onAction(submitPath, { draftId: job.draft?.id })}
    >
      <Send />
      {actionLabel(job, isSending)}
    </Button>
  );
}
