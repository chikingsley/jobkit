const GMAIL_API_ORIGIN = "https://gmail.googleapis.com/gmail/v1";

export interface GmailMessage {
  historyId?: string;
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
  snippet?: string;
  threadId: string;
}

export interface GmailMessagePart {
  body?: { data?: string };
  headers?: Array<{ name: string; value: string }>;
  mimeType?: string;
  parts?: GmailMessagePart[];
}

export interface GmailWatchResult {
  expiration: string;
  historyId: string;
}

export interface GmailHistoryPage {
  history?: Array<{
    messagesAdded?: Array<{ message: GmailMessage }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

export interface GmailMessageList {
  messages?: GmailMessage[];
  nextPageToken?: string;
}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

interface GmailDraftResult {
  id: string;
  message: GmailMessage;
}

export class GmailApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function createGmailDraft(accessToken: string, raw: string) {
  return gmailRequest<GmailDraftResult>(accessToken, "/users/me/drafts", {
    body: JSON.stringify({ message: { raw } }),
    method: "POST",
  });
}

export function sendGmailDraft(accessToken: string, draftId: string) {
  return gmailRequest<GmailMessage>(accessToken, "/users/me/drafts/send", {
    body: JSON.stringify({ id: draftId }),
    method: "POST",
  });
}

export function getGmailMessage(
  accessToken: string,
  messageId: string,
  format: "full" | "metadata" = "full"
) {
  const query = new URLSearchParams({ format });
  return gmailRequest<GmailMessage>(
    accessToken,
    `/users/me/messages/${encodeURIComponent(messageId)}?${query}`
  );
}

export function getGmailProfile(accessToken: string) {
  return gmailRequest<GmailProfile>(accessToken, "/users/me/profile");
}

export function listRecentInboxMessages(accessToken: string) {
  const query = new URLSearchParams({
    labelIds: "INBOX",
    maxResults: "100",
    q: "newer_than:30d",
  });
  return gmailRequest<GmailMessageList>(
    accessToken,
    `/users/me/messages?${query}`
  );
}

export function startGmailWatch(accessToken: string, topicName: string) {
  return gmailRequest<GmailWatchResult>(accessToken, "/users/me/watch", {
    body: JSON.stringify({
      labelFilterBehavior: "include",
      labelIds: ["INBOX"],
      topicName,
    }),
    method: "POST",
  });
}

export function listGmailHistory(
  accessToken: string,
  startHistoryId: string,
  pageToken?: string
) {
  const query = new URLSearchParams({
    historyTypes: "messageAdded",
    labelId: "INBOX",
    startHistoryId,
  });
  if (pageToken) {
    query.set("pageToken", pageToken);
  }
  return gmailRequest<GmailHistoryPage>(
    accessToken,
    `/users/me/history?${query}`
  );
}

async function gmailRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init.body) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${GMAIL_API_ORIGIN}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    let detail = "Gmail rejected the request";
    try {
      const body = (await response.json()) as {
        error?: { message?: string };
      };
      detail = body.error?.message?.slice(0, 500) || detail;
    } catch {
      // Gmail occasionally returns an HTML proxy error; do not expose it.
    }
    throw new GmailApiError(detail, response.status);
  }
  return (await response.json()) as T;
}
