export class GmailIntegrationError extends Error {
  readonly status: 400 | 401 | 403 | 409 | 502 | 503;

  constructor(
    message: string,
    options: ErrorOptions & { status?: 400 | 401 | 403 | 409 | 502 | 503 } = {}
  ) {
    super(message, options);
    this.status = options.status ?? 502;
  }
}

export function asGmailIntegrationError(error: unknown, fallback: string) {
  if (error instanceof GmailIntegrationError) {
    return error;
  }
  const detail = gmailErrorMessage(error);
  return new GmailIntegrationError(
    detail ? `${fallback}: ${detail}` : fallback,
    {
      cause: error,
    }
  );
}

export function gmailErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 1000)
    : "Unknown error";
}
