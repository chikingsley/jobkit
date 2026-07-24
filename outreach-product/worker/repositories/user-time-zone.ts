import { eq, sql } from "drizzle-orm";
import { excluded, getDb } from "../db/client";
import { userTimeZones } from "../db/schema/user-profile";

const DEFAULT_TIME_ZONE = "UTC";

export async function readUserTimeZone(
  db: D1Database,
  userId: string
): Promise<string> {
  const row = await getDb(db)
    .select({ timeZone: userTimeZones.timeZone })
    .from(userTimeZones)
    .where(eq(userTimeZones.userId, userId))
    .get();
  return row?.timeZone ?? DEFAULT_TIME_ZONE;
}

export async function writeUserTimeZone(
  db: D1Database,
  userId: string,
  timeZone: string
): Promise<string> {
  const normalized = timeZone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch (error) {
    throw new Error("Unknown IANA time zone", { cause: error });
  }
  await getDb(db)
    .insert(userTimeZones)
    .values({
      timeZone: normalized,
      updatedAt: new Date().toISOString(),
      userId,
    })
    .onConflictDoUpdate({
      set: {
        timeZone: excluded(userTimeZones.timeZone),
        updatedAt: excluded(userTimeZones.updatedAt),
      },
      setWhere: sql`user_time_zones.time_zone<>excluded.time_zone`,
      target: userTimeZones.userId,
    })
    .run();
  return normalized;
}
