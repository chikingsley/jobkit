import { type BetterAuthOptions, betterAuth } from "better-auth";
import type { AppEnv } from "./env";

const month = 60 * 60 * 24 * 30;

export const authOptions = {
  account: {
    encryptOAuthTokens: true,
    fields: {
      accessToken: "access_token",
      accessTokenExpiresAt: "access_token_expires_at",
      accountId: "account_id",
      createdAt: "created_at",
      idToken: "id_token",
      providerId: "provider_id",
      refreshToken: "refresh_token",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      updatedAt: "updated_at",
      userId: "user_id",
    },
    modelName: "user_accounts",
  },
  appName: "JobKit",
  emailAndPassword: {
    autoSignIn: true,
    enabled: true,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
      strategy: "compact",
    },
    expiresIn: month,
    fields: {
      createdAt: "created_at",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      updatedAt: "updated_at",
      userAgent: "user_agent",
      userId: "user_id",
    },
    modelName: "user_sessions",
    updateAge: 60 * 60 * 24,
  },
  user: {
    fields: {
      createdAt: "created_at",
      emailVerified: "email_verified",
      updatedAt: "updated_at",
    },
    modelName: "users",
  },
  verification: {
    fields: {
      createdAt: "created_at",
      expiresAt: "expires_at",
      updatedAt: "updated_at",
    },
    modelName: "auth_verifications",
    storeIdentifier: "hashed",
  },
} satisfies BetterAuthOptions;

export function createAuth(env: AppEnv, request: Request) {
  const { origin } = new URL(request.url);
  return betterAuth({
    ...authOptions,
    baseURL: origin,
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              accessType: "offline",
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              prompt: "select_account consent",
            },
          }
        : {},
    trustedOrigins: [origin],
  });
}
