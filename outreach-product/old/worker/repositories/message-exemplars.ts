import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { messageExemplars } from "../db/schema/message-style";

export interface MessageExemplar {
  body: string;
  country: string;
  outcome: string;
  outcomeGrade: number;
  sentAt: string;
  subject: string;
}

export function readMessageExemplars(
  db: D1Database,
  userId: string,
  country: string,
  limit = 3
): Promise<MessageExemplar[]> {
  return getDb(db)
    .select({
      body: messageExemplars.body,
      country: messageExemplars.country,
      outcome: messageExemplars.outcome,
      outcomeGrade: messageExemplars.outcomeGrade,
      sentAt: messageExemplars.sentAt,
      subject: messageExemplars.subject,
    })
    .from(messageExemplars)
    .where(eq(messageExemplars.userId, userId))
    .orderBy(
      desc(
        sql`(${messageExemplars.country}<>'' AND ${messageExemplars.country}=${country})`
      ),
      desc(messageExemplars.outcomeGrade),
      desc(messageExemplars.sentAt)
    )
    .limit(limit);
}
