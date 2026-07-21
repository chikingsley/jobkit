import type { z } from "zod";
import type { AppEnv } from "../../../env";
import { TestLabError } from "../errors";

export const JINA_API_BASE = "https://api.jina.ai/v1";
export const MAX_PROVIDER_RESPONSE_CHARACTERS = 4_000_000;

export async function jinaJson<T>(
  env: AppEnv,
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
  timeoutMs: number
) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: jinaHeaders(env, "application/json"),
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw providerFailure("Jina", response.status);
  }
  const text = await boundedText(response);
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: TestLabError forwards this ErrorOptions cause through its constructor.
    throw new TestLabError(
      "Jina returned a response outside its documented schema",
      502,
      { cause: error }
    );
  }
}

export async function jinaText(env: AppEnv, url: string, timeoutMs: number) {
  const response = await fetch(url, {
    headers: jinaHeaders(env, "text/plain"),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw providerFailure("Jina", response.status);
  }
  return boundedText(response);
}

export function jinaHeaders(env: AppEnv, accept: string) {
  return {
    accept,
    authorization: `Bearer ${env.JINA_API_KEY}`,
    "content-type": "application/json",
    "x-no-cache": "true",
  };
}

export function providerFailure(provider: string, status: number) {
  return new TestLabError(
    `${provider} benchmark request failed with status ${status}`,
    502
  );
}

async function boundedText(response: Response) {
  const text = await response.text();
  if (text.length > MAX_PROVIDER_RESPONSE_CHARACTERS) {
    throw new TestLabError(
      "Jina response exceeded the Test Lab size limit",
      502
    );
  }
  return text;
}
