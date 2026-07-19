import { format } from "date-fns";
import {
  DownloadIcon,
  FileTextIcon,
  MailPlusIcon,
  SendIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  MessageThreadDetail,
  ThreadAttachment,
  ThreadMessage,
} from "@/features/messages/types";
import type { ApiRequest } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  sending: "Sending…",
  sent: "Sent",
  uncertain: "Delivery unconfirmed",
};
const EMAIL_DOMAIN_PATTERN = /@.*$/u;
const NAME_SEPARATOR_PATTERN = /[._-]+/gu;
const WHITESPACE_PATTERN = /\s+/u;

export function MessageThread({
  detail,
  onUpdated,
  request,
}: {
  detail: MessageThreadDetail;
  onUpdated: () => Promise<unknown>;
  request: ApiRequest;
}) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport className="px-4 py-6">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl">
            <Marker variant="separator">
              <MarkerContent>{detail.subject}</MarkerContent>
            </Marker>
            <ThreadOutcomeControl
              detail={detail}
              onUpdated={onUpdated}
              request={request}
            />
            {detail.applicationTargets.length > 0 ? (
              <div className="mb-4 rounded-lg border bg-background p-3">
                <p className="font-medium text-xs">
                  Positions in this application
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.applicationTargets.map((target) => (
                    <Badge key={target.jobId} variant="outline">
                      {target.sourceReference} · {target.location}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {detail.messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor
              >
                <ThreadBubble message={message} />
              </MessageScrollerItem>
            ))}
            {detail.followUps.map((followUp) => (
              <FollowUpCard
                followUp={followUp}
                key={followUp.id}
                onUpdated={onUpdated}
                request={request}
              />
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

const OUTCOME_OPTIONS = [
  { label: "No outcome recorded", value: "none" },
  { label: "Interested", value: "interested" },
  { label: "Interview", value: "interview" },
  { label: "Offer", value: "offer" },
  { label: "Declined", value: "declined" },
  { label: "Withdrawn", value: "withdrawn" },
  { label: "Bounced", value: "bounced" },
  { label: "No response", value: "no_response" },
] as const;

function ThreadOutcomeControl({
  detail,
  onUpdated,
  request,
}: {
  detail: MessageThreadDetail;
  onUpdated: () => Promise<unknown>;
  request: ApiRequest;
}) {
  const [saving, setSaving] = useState(false);
  const currentNote = detail.outcome ? detail.outcome.note : "";
  const currentValue = detail.outcome ? detail.outcome.value : "none";

  async function save(value: string | null) {
    const selected = OUTCOME_OPTIONS.find((option) => option.value === value);
    if (!selected) {
      return;
    }
    setSaving(true);
    try {
      await request(
        `/api/messages/threads/${encodeURIComponent(detail.threadId)}/outcome`,
        {
          body: JSON.stringify({
            note: currentNote,
            outcome: selected.value === "none" ? null : selected.value,
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      );
      await onUpdated();
      toast.success("Conversation outcome saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Outcome save failed"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
      <div>
        <p className="font-medium text-xs">Outcome</p>
        <p className="text-muted-foreground text-xs">
          Track the result of this exact conversation.
        </p>
      </div>
      <Select
        disabled={saving}
        items={OUTCOME_OPTIONS}
        onValueChange={(value) => void save(value)}
        value={currentValue}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {OUTCOME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function FollowUpCard({
  followUp,
  onUpdated,
  request,
}: {
  followUp: MessageThreadDetail["followUps"][number];
  onUpdated: () => Promise<unknown>;
  request: ApiRequest;
}) {
  const [busy, setBusy] = useState(false);
  const ready = followUp.status === "review";

  async function createDraft() {
    setBusy(true);
    try {
      await request(
        `/api/messages/follow-ups/${encodeURIComponent(followUp.id)}/gmail-draft`,
        { method: "POST" }
      );
      await onUpdated();
      toast.success("Follow-up draft created in Gmail");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Follow-up draft failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendDraft() {
    setBusy(true);
    try {
      await request(
        `/api/messages/follow-ups/${encodeURIComponent(followUp.id)}/send`,
        { method: "POST" }
      );
      await onUpdated();
      toast.success("Follow-up sent");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Follow-up send failed"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-sm">Follow-up {followUp.ordinal}</p>
          <p className="text-muted-foreground text-xs">
            {followUpStatusLabel(followUp.status)}
          </p>
        </div>
        {ready ? (
          <Button disabled={busy} onClick={() => void createDraft()} size="sm">
            <MailPlusIcon />
            {busy ? "Creating…" : "Create Gmail draft"}
          </Button>
        ) : null}
        {followUp.status === "drafted" ? (
          <Button disabled={busy} onClick={() => void sendDraft()} size="sm">
            <SendIcon />
            {busy ? "Sending…" : "Send follow-up"}
          </Button>
        ) : null}
      </div>
      {followUp.message ? (
        <div className="mt-3 whitespace-pre-wrap break-words rounded-md bg-background p-3 text-sm leading-6">
          {followUp.message}
        </div>
      ) : null}
      {followUp.changeSummary ? (
        <p className="mt-2 text-muted-foreground text-xs">
          {followUp.changeSummary}
        </p>
      ) : null}
    </div>
  );
}

function followUpStatusLabel(status: string) {
  const labels: Record<string, string> = {
    canceled: "Canceled",
    drafted: "Ready in Gmail",
    drafting: "Codex is drafting",
    failed: "Drafting failed",
    review: "Ready for review",
    scheduled: "Codex is preparing this draft",
    sending: "Sending",
    sent: "Sent",
    uncertain: "Delivery unconfirmed",
  };
  return labels[status] ?? status;
}

function ThreadBubble({ message }: { message: ThreadMessage }) {
  const outbound = message.direction === "outbound";
  const author = outbound ? "You" : message.from;
  return (
    <Message align={outbound ? "end" : "start"}>
      <MessageAvatar>
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">
            {initialsOf(author)}
          </AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>
          <span className="font-medium text-foreground">{author}</span>
          <span className="ml-2 text-muted-foreground">
            {formatSentAt(message.sentAt)}
          </span>
        </MessageHeader>
        <Bubble
          align={outbound ? "end" : "start"}
          variant={outbound ? "tinted" : "muted"}
        >
          <BubbleContent>
            <div className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6">
              {message.body}
            </div>
          </BubbleContent>
        </Bubble>
        {message.attachments.length > 0 ? (
          <AttachmentGroup>
            {message.attachments.map((attachment) => (
              <ThreadAttachmentCard
                attachment={attachment}
                key={attachment.position}
              />
            ))}
          </AttachmentGroup>
        ) : null}
        <MessageFooter>
          <span>{STATUS_LABELS[message.status] ?? message.status}</span>
          {message.direction === "inbound" &&
          message.classification &&
          message.classification !== "human" ? (
            <Badge className="ml-2" variant="outline">
              {replyClassificationLabel(message.classification)}
            </Badge>
          ) : null}
          {message.error ? (
            <span className="ml-2 text-destructive">
              {message.error.detail}
            </span>
          ) : null}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

function replyClassificationLabel(
  classification: Exclude<ThreadMessage["classification"], "human" | null>
) {
  const labels = {
    automated: "Automated reply",
    bounce: "Bounce",
    vacation: "Vacation reply",
  } as const;
  return labels[classification];
}

function ThreadAttachmentCard({
  attachment,
}: {
  attachment: ThreadAttachment;
}) {
  const label = `Open ${attachment.filename}`;
  return (
    <Attachment size="sm">
      <AttachmentMedia>
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.filename}</AttachmentTitle>
        <AttachmentDescription>
          {describeAttachment(attachment)}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          aria-label={label}
          nativeButton={false}
          render={<a href={attachment.url} rel="noreferrer" target="_blank" />}
        >
          <DownloadIcon />
        </AttachmentAction>
      </AttachmentActions>
      <AttachmentTrigger
        render={
          <a
            aria-label={label}
            href={attachment.url}
            rel="noreferrer"
            target="_blank"
          />
        }
      />
    </Attachment>
  );
}

function describeAttachment(attachment: ThreadAttachment): string {
  const size = formatBytes(attachment.sizeBytes);
  const category = attachment.category
    ? attachment.category.replaceAll("_", " ")
    : "";
  return category ? `${category} · ${size}` : size;
}

function formatBytes(bytes: number): string {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatSentAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return format(date, "MMM d, yyyy · h:mm a");
}

function initialsOf(value: string): string {
  const cleaned = value
    .replace(EMAIL_DOMAIN_PATTERN, "")
    .replace(NAME_SEPARATOR_PATTERN, " ")
    .trim();
  const parts = cleaned.split(WHITESPACE_PATTERN).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
