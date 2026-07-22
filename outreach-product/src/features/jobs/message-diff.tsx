import { diffWordsWithSpace } from "diff";
import { messageDiffRows } from "@/features/jobs/message-diff-model";
import { cn } from "@/lib/utils";

function keyedChanges(before: string, after: string) {
  let beforeOffset = 0;
  let afterOffset = 0;
  return diffWordsWithSpace(before, after).map((change) => {
    let kind = "same";
    if (change.added) {
      kind = "added";
    } else if (change.removed) {
      kind = "removed";
    }
    const key = `${beforeOffset}:${afterOffset}:${kind}:${change.value.length}`;
    if (!change.added) {
      beforeOffset += change.value.length;
    }
    if (!change.removed) {
      afterOffset += change.value.length;
    }
    return { ...change, key };
  });
}

export function MessageText({
  highlightChanges,
  message,
  previousMessage,
}: {
  highlightChanges: boolean;
  message: string;
  previousMessage: string;
}) {
  const changes =
    highlightChanges && previousMessage
      ? keyedChanges(previousMessage, message)
      : [
          {
            added: false,
            key: "message",
            removed: false,
            value: message,
          },
        ];
  return (
    <div
      aria-label="Tailored application message"
      className="min-h-48 whitespace-pre-wrap border-primary/30 border-l-2 py-1 pl-4 text-sm leading-7"
      role="document"
    >
      {changes.map((change) =>
        change.removed ? null : (
          <mark
            className={cn(
              "bg-transparent text-inherit",
              change.added &&
                "rounded-sm bg-primary/15 shadow-[0_0_0_2px_color-mix(in_oklab,var(--primary)_15%,transparent)]"
            )}
            key={change.key}
          >
            {change.value}
          </mark>
        )
      )}
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
