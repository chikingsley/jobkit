import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import { z } from "zod";
import { GmailIntegrationError } from "../../src/pipeline/06_deliver/gmail-errors";
import {
  readGmailConnectionStatus,
  startOrRenewGmailWatch,
} from "../../src/pipeline/06_deliver/gmail-integration";
import {
  decodeGmailPushData,
  processGmailPush,
} from "../../src/pipeline/07_respond/gmail-replies";
import type { JobKitApp } from "../app-types";
import type { AppEnv } from "../env";

export const GMAIL_PUBSUB_WEBHOOK_PATH = "/api/webhooks/google/gmail";

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

const PubSubPushSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().min(1),
  }),
});

export function registerGmailRoutes(app: JobKitApp) {
  app.get("/api/gmail/status", async (c) => {
    const status = await readGmailConnectionStatus(c.env, c.get("user").id);
    return c.json({ ok: true, ...status });
  });

  app.post("/api/gmail/watch", async (c) =>
    c.json(await startOrRenewGmailWatch(c.env, c.get("user").id))
  );

  app.post(GMAIL_PUBSUB_WEBHOOK_PATH, async (c) => {
    await verifyPubSubIdentity(c.env, c.req.header("authorization") ?? "");
    const payload = PubSubPushSchema.parse(await c.req.json());
    const notification = decodeGmailPushData(payload.message.data);
    return c.json(
      await processGmailPush(c.env, {
        ...notification,
        messageId: payload.message.messageId,
      })
    );
  });
}

async function verifyPubSubIdentity(env: AppEnv, authorization: string) {
  if (!(env.GOOGLE_PUBSUB_AUDIENCE && env.GOOGLE_PUBSUB_SERVICE_ACCOUNT)) {
    throw new GmailIntegrationError(
      "Google Pub/Sub identity verification is not configured",
      { status: 503 }
    );
  }
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!token) {
    throw new GmailIntegrationError("Google Pub/Sub bearer token is required", {
      status: 401,
    });
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, googleJwks, {
      audience: env.GOOGLE_PUBSUB_AUDIENCE,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
    }));
  } catch (error) {
    throw new GmailIntegrationError(
      "Google Pub/Sub bearer token was not accepted",
      { cause: error, status: 401 }
    );
  }
  if (
    payload.email !== env.GOOGLE_PUBSUB_SERVICE_ACCOUNT ||
    payload.email_verified !== true
  ) {
    throw new GmailIntegrationError(
      "Google Pub/Sub service account was not accepted",
      { status: 401 }
    );
  }
}
