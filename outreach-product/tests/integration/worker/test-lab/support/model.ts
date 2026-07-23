import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export const testEnv = env as TestEnv;

export const TEXT_PLAIN_MIME_PATTERN =
  /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/u;

export function decodeTextPlainBody(mime: string) {
  const match = mime.match(TEXT_PLAIN_MIME_PATTERN);
  if (!match?.[1]) {
    throw new Error("Captured MIME text/plain part was not found");
  }
  const binary = atob(match[1].replaceAll("\r", "").replaceAll("\n", ""));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}

export async function digestSha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function digestBytesSha256(value: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadPng(cookie: string, filename: string) {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    ),
    (character) => character.charCodeAt(0)
  );
  const upload = await exports.default.fetch(
    "https://outreach.test/api/documents",
    {
      body: bytes,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "image/png",
        cookie,
        "x-jobkit-category": "test_lab",
        "x-jobkit-filename": encodeURIComponent(filename),
      },
      method: "PUT",
    }
  );
  if (!upload.ok) {
    throw new Error(`Test document upload failed (${upload.status})`);
  }
  const documents = await sessionRequest("/api/documents?scope=all", cookie);
  const payload = (await documents.json()) as {
    documents: Array<{ filename: string; id: string }>;
  };
  const document = payload.documents.find((item) => item.filename === filename);
  if (!document) {
    throw new Error("Uploaded test document was not listed");
  }
  return document.id;
}

export async function pairAgent(cookie: string) {
  const pairing = await sessionRequest(
    "/api/agent-runner-pairings",
    cookie,
    "POST",
    { capabilities: ["evaluation", "research"] }
  );
  const pairingPayload = (await pairing.json()) as {
    pairing: { code: string };
  };
  const exchange = await publicPost("/api/agent-runner-pairings/exchange", {
    code: pairingPayload.pairing.code,
    codexVersion: "codex-cli test",
    runnerName: "Test Lab agent",
  });
  const payload = (await exchange.json()) as { runner: { token: string } };
  return payload.runner.token;
}

export function sessionRequest(
  path: string,
  cookie: string,
  method = "GET",
  body?: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie,
    },
    method,
  });
}

export function publicPost(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function agentPost(
  path: string,
  token: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

export function agentGet(path: string, token: string) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}
