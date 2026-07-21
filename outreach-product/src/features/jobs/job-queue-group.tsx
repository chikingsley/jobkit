import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDown, Mail } from "lucide-react";
import type { JobContactGroup } from "@/features/jobs/job-contact-groups";
import { JobQueueItem } from "@/features/jobs/job-queue-item";
import type { FxData, JobListItem } from "@/features/jobs/types";
import type { JobMatchSummary } from "@/profile-types";

function contactLabel(group: JobContactGroup, primary: JobListItem) {
  const { contact } = group;
  if (!contact) {
    return "Shared application contact";
  }
  return (
    contact.displayName ||
    contact.organizationName ||
    primary.applicationRoutes.find(
      (route) => route.kind === "email" && route.status === "active"
    )?.destination ||
    "Shared application contact"
  );
}

export function JobQueueGroup({
  fx,
  group,
  matches,
  onSelect,
  selectedId,
}: {
  fx: FxData;
  group: JobContactGroup;
  matches: Map<string, JobMatchSummary>;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const [primary, ...related] = group.jobs;
  if (!primary) {
    return null;
  }
  if (related.length === 0) {
    return (
      <JobQueueItem
        active={primary.id === selectedId}
        fx={fx}
        job={primary}
        match={matches.get(primary.id)}
        onSelect={() => onSelect(primary.id)}
      />
    );
  }
  const selectedRelated = related.some((job) => job.id === selectedId);
  return (
    <div className="relative mb-2 pb-1">
      <div
        aria-hidden
        className="absolute inset-x-2 bottom-0 h-3 rounded-b-xl border bg-muted/60"
      />
      <Collapsible.Root
        className="relative rounded-xl border bg-background p-1 shadow-sm"
        defaultOpen={selectedRelated}
        key={`${group.id}:${selectedId ?? "none"}`}
      >
        <JobQueueItem
          active={primary.id === selectedId}
          fx={fx}
          job={primary}
          match={matches.get(primary.id)}
          onSelect={() => onSelect(primary.id)}
        />
        <Collapsible.Trigger className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-muted-foreground text-xs hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex min-w-0 items-center gap-2">
            <Mail className="size-3.5 shrink-0" />
            <span className="truncate">
              {group.jobs.length} listings share {contactLabel(group, primary)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 font-medium">
            View {related.length} more
            <ChevronDown className="size-3.5" />
          </span>
        </Collapsible.Trigger>
        <Collapsible.Panel className="border-t pt-1">
          {related.map((job) => (
            <JobQueueItem
              active={job.id === selectedId}
              fx={fx}
              job={job}
              key={job.id}
              match={matches.get(job.id)}
              onSelect={() => onSelect(job.id)}
            />
          ))}
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  );
}
