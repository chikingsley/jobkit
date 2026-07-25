import { eq } from "drizzle-orm";
import {
  type MessageStyleChoice,
  type MessageStyleChoices,
  messageStyleComparisons,
  messageStyleGuidance,
} from "../../src/features/message-style/calibration";
import { excluded, getDb } from "../db/client";
import { userMessageStyleChoices } from "../db/schema/message-style";

export async function readMessageStyleChoices(
  db: D1Database,
  userId: string
): Promise<MessageStyleChoices> {
  const rows = await getDb(db)
    .select({
      choice: userMessageStyleChoices.choice,
      comparisonId: userMessageStyleChoices.comparisonId,
    })
    .from(userMessageStyleChoices)
    .where(eq(userMessageStyleChoices.userId, userId));
  return Object.fromEntries(
    rows.map((row) => [row.comparisonId, row.choice as MessageStyleChoice])
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
  await getDb(db)
    .insert(userMessageStyleChoices)
    .values({
      choice,
      comparisonId,
      createdAt: timestamp,
      updatedAt: timestamp,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        choice: excluded(userMessageStyleChoices.choice),
        updatedAt: excluded(userMessageStyleChoices.updatedAt),
      },
      target: [
        userMessageStyleChoices.userId,
        userMessageStyleChoices.comparisonId,
      ],
    })
    .run();
}
