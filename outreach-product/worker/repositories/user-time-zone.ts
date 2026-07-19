const DEFAULT_TIME_ZONE = "UTC";

export async function readUserTimeZone(
  db: D1Database,
  userId: string
): Promise<string> {
  const row = await db
    .prepare("SELECT time_zone FROM user_time_zones WHERE user_id=?")
    .bind(userId)
    .first<{ time_zone: string }>();
  return row?.time_zone ?? DEFAULT_TIME_ZONE;
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
  await db
    .prepare(
      `INSERT INTO user_time_zones (user_id,time_zone,updated_at)
       VALUES (?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         time_zone=excluded.time_zone,updated_at=excluded.updated_at
       WHERE user_time_zones.time_zone<>excluded.time_zone`
    )
    .bind(userId, normalized, new Date().toISOString())
    .run();
  return normalized;
}
