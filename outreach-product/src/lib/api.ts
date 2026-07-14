export type ApiRequest = (
  path: string,
  init?: RequestInit
) => Promise<Response>;

export const apiRequest: ApiRequest = async (path, init) => {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.ok) {
    return response;
  }

  let message = `Request failed (${response.status})`;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      const { message: responseMessage } = body;
      message = responseMessage;
    }
  } catch {
    // Preserve the status-based fallback for non-JSON responses.
  }
  throw new Error(message);
};
