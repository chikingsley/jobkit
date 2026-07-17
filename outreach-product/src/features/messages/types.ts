export interface ThreadAttachment {
  category: string;
  contentType: string;
  filename: string;
  position: number;
  sizeBytes: number;
  url: string;
}

export interface ThreadMessage {
  attachments: ThreadAttachment[];
  body: string;
  direction: "inbound" | "outbound";
  error: null | { detail: string; stage: string };
  from: string;
  gmailMessageId: string;
  id: string;
  sentAt: string;
  status: string;
  subject: string;
  to: string;
}

export interface MessageThreadSummary {
  attachmentCount: number;
  attemptId: string;
  company: string;
  country: string;
  jobId: string;
  lastActivityAt: string;
  location: string;
  messageCount: number;
  preview: string;
  recipient: string;
  sentAt: string;
  status: string;
  subject: string;
  threadId: string;
  title: string;
  unreadCount: number;
}

export interface MessageThreadDetail {
  company: string;
  gmailThreadId: string;
  jobId: string;
  messages: ThreadMessage[];
  recipient: string;
  subject: string;
  threadId: string;
  title: string;
}
