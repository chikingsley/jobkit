import { parse } from "node-html-parser";
import type { AppEnv } from "../../env";
import type { GmailMessage, GmailMessagePart } from "../gmail-api";
import { GmailIntegrationError } from "../gmail-errors";

export function classificationEvidence(headers: Map<string, string>) {
  return Object.fromEntries(
    [
      "from",
      "auto-submitted",
      "precedence",
      "list-id",
      "x-autoreply",
      "x-autorespond",
      "x-failed-recipients",
    ]
      .map((name) => [name, headers.get(name) ?? ""] as const)
      .filter(([, value]) => value !== "")
  );
}

export function messageText(message: GmailMessage) {
  const plain = decodedPart(message.payload, "text/plain");
  if (plain.trim()) {
    return plain.trim().slice(0, 100_000);
  }
  const html = decodedPart(message.payload, "text/html");
  if (html.trim()) {
    return parse(html).textContent.trim().slice(0, 100_000);
  }
  return (message.snippet?.trim() || "(no text body)").slice(0, 100_000);
}

function decodedPart(
  part: GmailMessagePart | undefined,
  mimeType: string
): string {
  if (!part) {
    return "";
  }
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const value = decodedPart(child, mimeType);
    if (value) {
      return value;
    }
  }
  return "";
}

export function messageSentAt(message: GmailMessage) {
  const milliseconds = Number(message.internalDate ?? "");
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toISOString()
    : new Date().toISOString();
}

export function decodeBase64(value: string) {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function recordPubSubEvent(
  db: D1Database,
  input: { emailAddress: string; historyId: string; messageId: string },
  messagesRecorded: number
) {
  const timestamp = new Date().toISOString();
  return db.batch([
    pubSubEventStatement(db, input, messagesRecorded, timestamp),
  ]);
}

export function pubSubEventStatement(
  db: D1Database,
  input: { emailAddress: string; historyId: string; messageId: string },
  messagesRecorded: number,
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO gmail_pubsub_events
        (message_id,email_address,history_id,received_at,processed_at,messages_recorded)
       VALUES (?,?,?,?,?,?) ON CONFLICT(message_id) DO NOTHING`
    )
    .bind(
      input.messageId,
      input.emailAddress,
      input.historyId,
      timestamp,
      timestamp,
      messagesRecorded
    );
}

export function latestHistoryId(left: string, right: string) {
  return compareHistoryIds(left, right) >= 0 ? left : right;
}

export function compareHistoryIds(left: string, right: string) {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  if (leftId === rightId) {
    return 0;
  }
  return leftId > rightId ? 1 : -1;
}

export function requiredTopicName(env: AppEnv) {
  if (!env.GOOGLE_PUBSUB_TOPIC) {
    throw new GmailIntegrationError("Gmail Pub/Sub topic is not configured", {
      status: 503,
    });
  }
  return env.GOOGLE_PUBSUB_TOPIC;
}
