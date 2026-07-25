import type { AppEnv } from "../env";

const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const INDEXING_PUBLISH_URL =
  "https://indexing.googleapis.com/v3/urlNotifications:publish";
const MAX_EVENTS_PER_RUN = 10;
const MAX_ATTEMPTS = 8;

interface IndexingEventRow {
  attempt_count: number;
  canonical_path: string;
  event_type: "URL_DELETED" | "URL_UPDATED";
  id: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

export async function processGoogleIndexingOutbox(env: AppEnv) {
  const serviceAccount = parseServiceAccount(
    env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON
  );
  if (!serviceAccount) {
    return { configured: false, delivered: 0, failed: 0 };
  }
  const accessToken = await serviceAccountAccessToken(serviceAccount);
  let delivered = 0;
  let failed = 0;
  for (let index = 0; index < MAX_EVENTS_PER_RUN; index += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each claimed indexing event is acknowledged before the next durable claim.
    const event = await claimIndexingEvent(env.DB);
    if (!event) {
      break;
    }
    const outcome = await deliverIndexingEvent(
      accessToken,
      new URL(event.canonical_path, env.APP_ORIGIN).toString(),
      event.event_type
    );
    if (outcome.ok) {
      await markIndexingEventDelivered(env.DB, event.id, outcome.body);
      delivered += 1;
      continue;
    }
    await markIndexingEventFailed(env.DB, event, outcome);
    failed += 1;
  }
  return { configured: true, delivered, failed };
}

function claimIndexingEvent(db: D1Database) {
  const timestamp = now();
  return db
    .prepare(
      `UPDATE google_indexing_events
          SET status='processing',attempt_count=attempt_count+1,updated_at=?
        WHERE id=(
          SELECT id FROM google_indexing_events
           WHERE status='pending' AND next_attempt_at<=?
           ORDER BY created_at,id LIMIT 1
        )
        RETURNING id,canonical_path,event_type,attempt_count`
    )
    .bind(timestamp, timestamp)
    .first<IndexingEventRow>();
}

async function deliverIndexingEvent(
  accessToken: string,
  url: string,
  type: IndexingEventRow["event_type"]
) {
  try {
    const response = await fetch(INDEXING_PUBLISH_URL, {
      body: JSON.stringify({ type, url }),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    const body = await boundedBody(response);
    return { body, ok: response.ok, status: response.status };
  } catch (error) {
    return {
      body: JSON.stringify({
        message: error instanceof Error ? error.message : "Network error",
      }),
      ok: false,
      status: 0,
    };
  }
}

function markIndexingEventDelivered(
  db: D1Database,
  eventId: string,
  responseJson: string
) {
  const timestamp = now();
  return db
    .prepare(
      `UPDATE google_indexing_events
          SET status='delivered',response_json=?,last_error='',
              delivered_at=?,updated_at=?
        WHERE id=? AND status='processing'`
    )
    .bind(validJsonObject(responseJson), timestamp, timestamp, eventId)
    .run();
}

function markIndexingEventFailed(
  db: D1Database,
  event: IndexingEventRow,
  outcome: { body: string; status: number }
) {
  const terminal = event.attempt_count >= MAX_ATTEMPTS;
  const timestamp = now();
  return db
    .prepare(
      `UPDATE google_indexing_events
          SET status=?,next_attempt_at=?,last_error=?,response_json=?,
              updated_at=?
        WHERE id=? AND status='processing'`
    )
    .bind(
      terminal ? "failed" : "pending",
      terminal ? timestamp : retryAt(event.attempt_count),
      `HTTP ${outcome.status}`,
      validJsonObject(outcome.body),
      timestamp,
      event.id
    )
    .run();
}

async function serviceAccountAccessToken(account: ServiceAccount) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  );
  const claim = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: account.token_uri,
        exp: issuedAt + 3600,
        iat: issuedAt,
        iss: account.client_email,
        scope: INDEXING_SCOPE,
      })
    )
  );
  const unsigned = `${header}.${claim}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importPrivateKey(account.private_key),
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(account.token_uri, {
    body: new URLSearchParams({
      assertion,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body = (await response.json()) as {
    access_token?: unknown;
    error_description?: unknown;
  };
  if (!(response.ok && typeof body.access_token === "string")) {
    throw new Error(
      typeof body.error_description === "string"
        ? body.error_description
        : `Google token exchange failed with HTTP ${response.status}`
    );
  }
  return body.access_token;
}

function parseServiceAccount(value: string | undefined): ServiceAccount | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<ServiceAccount>;
    if (
      typeof parsed.client_email === "string" &&
      typeof parsed.private_key === "string" &&
      typeof parsed.token_uri === "string"
    ) {
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        token_uri: parsed.token_uri,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function importPrivateKey(pem: string) {
  const encoded = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/gu, "");
  const bytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0)
  );
  return crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
    false,
    ["sign"]
  );
}

async function boundedBody(response: Response) {
  const text = (await response.text()).slice(0, 8000);
  return validJsonObject(text);
}

function validJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(
      typeof parsed === "object" && parsed !== null ? parsed : { value: parsed }
    );
  } catch {
    return JSON.stringify({ message: value });
  }
}

function retryAt(attemptCount: number) {
  const delayMinutes = Math.min(24 * 60, 2 ** attemptCount);
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function now() {
  return new Date().toISOString();
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/[=]+$/gu, "");
}
