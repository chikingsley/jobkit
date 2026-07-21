import { Mail, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Job } from "@/features/jobs/types";

function fileSize(bytes: number) {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function ApplicationDelivery({ job }: { job: Job }) {
  const emailRoute = job.applicationRoutes.find(
    (route) => route.kind === "email"
  );
  if (!emailRoute) {
    return null;
  }
  const recipient = job.emailAttempt
    ? job.emailAttempt.recipient
    : emailRoute.destination;
  const subject = job.emailAttempt
    ? job.emailAttempt.subject
    : "Created when you send";
  const attachments = job.draft ? job.draft.attachments : [];
  const { contact } = emailRoute;

  return (
    <div className="grid gap-x-8 gap-y-4 text-sm lg:grid-cols-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
          <Mail className="size-3.5" /> To
        </div>
        <p className="mt-1 break-all">{recipient}</p>
        {contact && contact.relatedListingCount > 1 ? (
          <p className="mt-1 text-muted-foreground text-xs">
            {contact.role === "board_intermediary"
              ? `Shared board inbox used by ${contact.relatedListingCount.toLocaleString()} listings`
              : `${contact.relatedListingCount.toLocaleString()} listings route to this contact`}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="font-medium text-muted-foreground text-xs">Subject</div>
        <p className="mt-1">{subject}</p>
      </div>
      <div className="lg:col-span-2">
        <div className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
          <Paperclip className="size-3.5" /> Attachments
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.length ? (
            attachments.map((attachment) => (
              <Badge key={attachment.filename} variant="outline">
                {attachment.filename} · {fileSize(attachment.sizeBytes)}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">No files attached</span>
          )}
        </div>
      </div>
    </div>
  );
}
