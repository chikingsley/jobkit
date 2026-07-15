import {
  type MessageStyleChoice,
  type MessageStyleChoices,
  messageStyleComparisons,
  messageStyleGuidance,
} from "../../src/features/message-style/calibration";

export async function readMessageStyleChoices(
  db: D1Database,
  userId: string
): Promise<MessageStyleChoices> {
  const rows = await db
    .prepare(
      "SELECT comparison_id,choice FROM user_message_style_choices WHERE user_id=?"
    )
    .bind(userId)
    .all<{ choice: MessageStyleChoice; comparison_id: string }>();
  return Object.fromEntries(
    rows.results.map((row) => [row.comparison_id, row.choice])
  );
}

export async function readMessageStyleGuidance(
  db: D1Database,
  userId: string
): Promise<string[]> {
  return messageStyleGuidance(await readMessageStyleChoices(db, userId));
}

export async function writeMessageStyleChoice(
  db: D1Database,
  userId: string,
  comparisonId: string,
  choice: MessageStyleChoice
): Promise<void> {
  if (!messageStyleComparisons.some((item) => item.id === comparisonId)) {
    throw new Error("Unknown message-style comparison");
  }
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO user_message_style_choices
        (user_id,comparison_id,choice,created_at,updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(user_id,comparison_id) DO UPDATE SET
         choice=excluded.choice,updated_at=excluded.updated_at`
    )
    .bind(userId, comparisonId, choice, timestamp, timestamp)
    .run();
}
