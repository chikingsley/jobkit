import { createAuth } from "../../../worker/auth";
import type { AppEnv } from "../../../worker/env";
import { CANONICAL_SITE_ORIGIN } from "../../lib/site-origin";
import { GmailIntegrationError } from "./gmail-errors";

const TRAILING_SLASH_PATTERN = /\/$/u;

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

export async function getGoogleAccessToken(env: AppEnv, userId: string) {
  if (!gmailConfigurationIsAvailable(env)) {
    throw new GmailIntegrationError("Hosted Gmail is not configured yet", {
      status: 503,
    });
  }
  try {
    const request = new Request(`${appOrigin(env)}/api/auth/internal`);
    const token = await createAuth(env, request).api.getAccessToken({
      body: { providerId: "google", userId },
    });
    if (!token.accessToken) {
      throw new Error("Google did not return an access token");
    }
    return token.accessToken;
  } catch (error) {
    throw new GmailIntegrationError(
      "Connect Gmail in Messages before sending applications",
      { cause: error, status: 409 }
    );
  }
}

export function gmailConfigurationIsAvailable(env: AppEnv) {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_PUBSUB_TOPIC &&
      env.GOOGLE_PUBSUB_AUDIENCE &&
      env.GOOGLE_PUBSUB_SERVICE_ACCOUNT
  );
}

function appOrigin(env: AppEnv) {
  return (env.APP_ORIGIN || CANONICAL_SITE_ORIGIN).replace(
    TRAILING_SLASH_PATTERN,
    ""
  );
}
