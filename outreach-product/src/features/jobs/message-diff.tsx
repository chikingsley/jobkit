import {
  messageDiffRows,
  messageHighlightRuns,
} from "@/features/jobs/message-diff-model";
import { cn } from "@/lib/utils";

export function MessageText({
  highlightChanges,
  message,
  previousMessage,
}: {
  highlightChanges: boolean;
  message: string;
  previousMessage: string;
}) {
  const runs =
    highlightChanges && previousMessage
      ? messageHighlightRuns(previousMessage, message)
      : [
          {
            highlighted: false,
            key: "message",
            text: message,
          },
        ];
  return (
    <div
      aria-label="Tailored application message"
      className="whitespace-pre-wrap py-1 text-sm leading-7"
      role="document"
    >
      {runs.map((run) => (
        <mark
          className={cn(
            "bg-transparent text-inherit",
            run.highlighted &&
              "-mx-[0.06em] rounded-[0.15em] bg-[oklch(0.92_0.14_100)] box-decoration-clone px-[0.06em] dark:bg-[oklch(0.40_0.08_95)]"
          )}
          data-message-change-highlight={run.highlighted ? "true" : undefined}
          key={run.key}
        >
          {run.text}
        </mark>
      ))}
    </div>
  );
}

export function MessageChanges({
  message,
  previousMessage,
  version,
}: {
  message: string;
  previousMessage: string;
  version?: number;
}) {
  if (!previousMessage || previousMessage === message) {
    return null;
  }
  const rows = messageDiffRows(previousMessage, message);
  return (
    <details className="group rounded-lg border text-sm">
      <summary className="cursor-pointer list-none px-3 py-3 font-medium marker:content-none">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="transition-transform group-open:rotate-90"
          >
            ▶
          </span>
          View changes
          {version && version > 1 ? (
            <span className="font-normal text-muted-foreground text-xs">
              v{version - 1} → v{version}
            </span>
          ) : null}
        </span>
      </summary>
      <section
        aria-label="Message changes"
        className="overflow-hidden border-t font-mono text-xs leading-5"
      >
        {rows.map((row) =>
          row.kind === "collapsed" ? (
            <div
              className="bg-muted/50 px-3 py-1.5 text-center text-muted-foreground"
              key={row.key}
            >
              ⋯ {row.collapsedCount?.toLocaleString()} unchanged line
              {row.collapsedCount === 1 ? "" : "s"} ⋯
            </div>
          ) : (
            <div
              className={cn(
                "grid grid-cols-[2rem_2rem_1.25rem_minmax(0,1fr)] border-t first:border-t-0",
                row.kind === "added" && "bg-emerald-500/10",
                row.kind === "removed" && "bg-destructive/10"
              )}
              key={row.key}
            >
              <span className="select-none border-r px-1 text-right text-muted-foreground">
                {row.beforeLine ?? ""}
              </span>
              <span className="select-none border-r px-1 text-right text-muted-foreground">
                {row.afterLine ?? ""}
              </span>
              <span
                aria-hidden
                className={cn(
                  "select-none text-center",
                  row.kind === "added" &&
                    "text-emerald-700 dark:text-emerald-300",
                  row.kind === "removed" && "text-destructive"
                )}
              >
                {diffGlyph(row.kind)}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words px-2">
                {row.text || " "}
              </span>
            </div>
          )
        )}
      </section>
    </details>
  );
}

function diffGlyph(kind: "added" | "collapsed" | "removed" | "same") {
  if (kind === "added") {
    return "+";
  }
  if (kind === "removed") {
    return "−";
  }
  return " ";
}
