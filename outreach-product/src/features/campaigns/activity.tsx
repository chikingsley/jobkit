import { Badge } from "@/components/ui/badge";
import type {
  CampaignReplyEvent,
  CampaignRun,
} from "@/features/campaigns/types";

export function CampaignActivity({
  replies,
  runs,
}: {
  replies: CampaignReplyEvent[];
  runs: CampaignRun[];
}) {
  if (runs.length === 0 && replies.length === 0) {
    return null;
  }
  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <RunHistory runs={runs} />
      <ReplyHistory replies={replies} />
    </section>
  );
}

function RunHistory({ runs }: { runs: CampaignRun[] }) {
  return (
    <section className="grid content-start gap-3 border-t pt-4">
      <h2 className="font-semibold">Delivery runs</h2>
      <div className="grid gap-3">
        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No delivery run has started.
          </p>
        ) : (
          runs.map((run) => (
            <div
              className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
              key={run.id}
            >
              <div>
                <div className="font-medium text-sm">
                  {formatDateTime(run.scheduledFor)}
                </div>
                <p className="mt-1 text-muted-foreground text-xs">
                  {run.sentDispatchCount.toLocaleString()} sent of{" "}
                  {run.plannedDispatchCount.toLocaleString()} planned ·{" "}
                  {run.postedTargetPercent.toLocaleString()}% posted target
                </p>
                {run.errorDetail ? (
                  <p className="mt-1 text-destructive text-xs">
                    {run.errorDetail}
                  </p>
                ) : null}
              </div>
              <Badge variant="outline">{humanize(run.status)}</Badge>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ReplyHistory({ replies }: { replies: CampaignReplyEvent[] }) {
  return (
    <section className="grid content-start gap-3 border-t pt-4">
      <h2 className="font-semibold">Reply outcomes</h2>
      <div className="grid gap-3">
        {replies.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No reply event has arrived.
          </p>
        ) : (
          replies.map((reply) => (
            <div
              className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
              key={reply.id}
            >
              <div>
                <div className="font-medium text-sm">
                  {humanize(reply.classification)} reply
                </div>
                <p className="mt-1 text-muted-foreground text-xs">
                  {formatDateTime(reply.receivedAt)} ·{" "}
                  {reply.countsTowardPause
                    ? "counts toward pause"
                    : "recorded only"}
                </p>
              </div>
              <Badge variant={reply.countsTowardPause ? "default" : "outline"}>
                {reply.countsTowardPause ? "Human" : "Ignored"}
              </Badge>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
