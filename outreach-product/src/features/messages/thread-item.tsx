import { format, isThisYear } from "date-fns";
import { PaperclipIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MessageThreadSummary } from "@/features/messages/types";
import { cn } from "@/lib/utils";

const STATUS_BADGES: Record<
  string,
  { label: string; variant: "secondary" | "outline" }
> = {
  sending: { label: "Sending", variant: "outline" },
  sent: { label: "Sent", variant: "secondary" },
  uncertain: { label: "Unconfirmed", variant: "outline" },
};

export function MessageThreadItem({
  active,
  onSelect,
  thread,
}: {
  active: boolean;
  onSelect: () => void;
  thread: MessageThreadSummary;
}) {
  const badge = STATUS_BADGES[thread.status] ?? {
    label: thread.status,
    variant: "outline" as const,
  };
  return (
    <button
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        active && "border-border bg-muted"
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-sm">
          {thread.company || thread.title}
        </span>
        <span className="shrink-0 text-muted-foreground text-xs">
          {formatAppliedDate(thread.sentAt)}
        </span>
      </div>
      <div className="truncate text-muted-foreground text-xs">
        {thread.title} · {thread.recipient}
      </div>
      {thread.preview ? (
        <div className="truncate text-muted-foreground text-sm">
          {thread.preview}
        </div>
      ) : null}
      <div className="mt-0.5 flex items-center gap-2">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {thread.targetCount > 1 ? (
          <Badge variant="outline">{thread.targetCount} positions</Badge>
        ) : null}
        {thread.attachmentCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
            <PaperclipIcon className="size-3" />
            {thread.attachmentCount}
          </span>
        ) : null}
        {thread.unreadCount > 0 ? (
          <Badge className="ml-auto">{thread.unreadCount}</Badge>
        ) : null}
      </div>
    </button>
  );
}

function formatAppliedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return isThisYear(date) ? format(date, "MMM d") : format(date, "MMM d, yyyy");
}
