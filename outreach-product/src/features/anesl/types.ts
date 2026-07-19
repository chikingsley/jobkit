import type { JobDraft } from "@/features/jobs/types";

export interface AneslApplicationTarget {
  jobId: string;
  location: string;
  ordinal: number;
  routeId: string;
  sourceReference: string;
  title: string;
}

export interface AneslApplicationSet {
  attempt: null | { id: string; status: string };
  createdAt: string;
  draft: JobDraft | null;
  draftTask: {
    error: string;
    id: string;
    mode: "generate" | "revise";
    status: "cancelled" | "claimed" | "completed" | "failed" | "queued";
    updatedAt: string;
  } | null;
  id: string;
  recipient: string;
  sentAt: string | null;
  status: "approved" | "cancelled" | "failed" | "review" | "sent";
  subject: string;
  targets: AneslApplicationTarget[];
  testSend: null | {
    recipient: string;
    replyReceivedAt: string | null;
    sentAt: string | null;
    status: string;
  };
  updatedAt: string;
}

export interface AneslApplicationSetResponse {
  applicationSet: AneslApplicationSet;
  notice?: string;
  ok: true;
  taskRequest?: {
    id: string;
    status: "claimed" | "queued";
  };
}
