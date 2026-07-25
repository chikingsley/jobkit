interface PublicCursorSecretEnv {
  PUBLIC_JOB_CURSOR_SECRET?: string;
}

const LOCAL_PUBLIC_JOB_CURSOR_SECRET = "jobkit-local-public-cursor-v1";

export function resolvePublicJobCursorSecret(
  env: PublicCursorSecretEnv,
  isDevelopment: boolean
): string {
  const configuredSecret = env.PUBLIC_JOB_CURSOR_SECRET?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }
  if (isDevelopment) {
    return LOCAL_PUBLIC_JOB_CURSOR_SECRET;
  }
  throw new Error("PUBLIC_JOB_CURSOR_SECRET is unavailable");
}
