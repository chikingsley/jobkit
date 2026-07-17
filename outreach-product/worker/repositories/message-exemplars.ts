export interface MessageExemplar {
  body: string;
  country: string;
  outcome: string;
  outcomeGrade: number;
  sentAt: string;
  subject: string;
}

interface ExemplarRow {
  body: string;
  country: string;
  outcome: string;
  outcome_grade: number;
  sent_at: string;
  subject: string;
}

// Prefer exemplars from the same country, then the best outcomes, then the
// most recent voice. An empty table simply yields no examples.
export async function readMessageExemplars(
  db: D1Database,
  userId: string,
  country: string,
  limit = 3
): Promise<MessageExemplar[]> {
  const rows = await db
    .prepare(
      `SELECT subject,body,country,outcome,outcome_grade,sent_at
         FROM message_exemplars
        WHERE user_id=?1
        ORDER BY (country<>'' AND country=?2) DESC,
                 outcome_grade DESC,
                 sent_at DESC
        LIMIT ?3`
    )
    .bind(userId, country, limit)
    .all<ExemplarRow>();
  return rows.results.map((row) => ({
    body: row.body,
    country: row.country,
    outcome: row.outcome,
    outcomeGrade: row.outcome_grade,
    sentAt: row.sent_at,
    subject: row.subject,
  }));
}
