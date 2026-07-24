export type ApiRequest = (
  path: string,
  init?: RequestInit
) => Promise<Response>;

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiRequest(path, init);
  return (await response.json()) as T;
}

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
