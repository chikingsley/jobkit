export class TestLabError extends Error {
  readonly status: 400 | 404 | 409 | 502 | 503;

  constructor(
    message: string,
    status: 400 | 404 | 409 | 502 | 503,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.status = status;
  }
}
