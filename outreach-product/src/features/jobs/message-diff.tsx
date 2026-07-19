import { diffWordsWithSpace } from "diff";
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
      className="min-h-72 whitespace-pre-wrap rounded-lg border bg-background p-4 text-sm leading-7 shadow-xs"
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
}: {
  message: string;
  previousMessage: string;
}) {
  if (!previousMessage || previousMessage === message) {
    return null;
  }
  const changes = keyedChanges(previousMessage, message);
  return (
    <details className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">View changes</summary>
      <div className="mt-3 whitespace-pre-wrap rounded-md bg-background p-3 leading-6">
        {changes.map((change) => (
          <span
            className={cn(
              change.added && "bg-primary/15",
              change.removed &&
                "bg-destructive/10 text-destructive line-through"
            )}
            key={change.key}
          >
            {change.value}
          </span>
        ))}
      </div>
    </details>
  );
}
