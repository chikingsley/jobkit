import type { ApplicationMessageRoute } from "../../../../worker/schemas";
import { advertisedPositionQuestion } from "../../04_compose/application-message-policy";
import type { getGmailMessage } from "../../06_deliver/gmail-api";
import { type FoundationRow, REPLY_SUBJECT_PATTERN } from "./model";

export function openingFrom(message: string) {
  const [firstLine] = message.replaceAll("\r\n", "\n").trim().split("\n");
  return firstLine?.startsWith("Hello") ? firstLine : "Hello,";
}

export function followUpQuestion(
  route: ApplicationMessageRoute,
  createdAt: string,
  timeZone: string
) {
  if (route === "multi_position") {
    return "Which locations and student groups are you currently recruiting for?";
  }
  if (route === "school_outreach") {
    return "Would you be open to speaking about whether there could be a position that fits my background?";
  }
  return advertisedPositionQuestion(new Date(createdAt), timeZone);
}

export function voiceRules(row: FoundationRow | null) {
  if (!row) {
    return [];
  }
  const parsed = JSON.parse(row.voice_rules_json) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((rule): rule is string => typeof rule === "string")
    : [];
}

export function gmailHeader(
  message: Awaited<ReturnType<typeof getGmailMessage>>,
  name: string
) {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase()
  )?.value;
}

export function replySubject(subject: string) {
  return REPLY_SUBJECT_PATTERN.test(subject.trim())
    ? subject.trim()
    : `Re: ${subject.trim()}`;
}
