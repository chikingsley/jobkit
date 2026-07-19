import { join } from "node:path";
import { sleep, spawn } from "bun";
import { defaultPreferences } from "../../src/features/preferences/schema";
import { defaultProfile } from "../../src/features/profile/schema";

const host = "127.0.0.1";
const port = 4177;
const baseUrl = `http://${host}:${port}`;
const email = "maestro.local@jobkit.test";
const password = "maestro-local-password";
const flowTag = process.argv[2] ?? "safe";
const maestro = join(process.env.HOME ?? "", ".maestro", "bin", "maestro");
let server: ReturnType<typeof spawn> | null = null;

try {
  await command([
    "bunx",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "jobkit-outreach",
    "--local",
  ]);
  await startServer();
  await prepareAccount();
  await stopServer();
  await command([
    "bunx",
    "wrangler",
    "d1",
    "execute",
    "jobkit-outreach",
    "--local",
    "--file",
    "tests/e2e/fixtures/maestro.sql",
  ]);
  await startServer();
  await command([
    maestro,
    "test",
    ".maestro/flows",
    "--config",
    ".maestro/config.yaml",
    "--headless",
    "--screen-size",
    "1366x900",
    "--include-tags",
    flowTag,
    "--test-output-dir",
    "test-results/maestro",
    "-e",
    `JOBKIT_URL=${baseUrl}`,
    "-e",
    `JOBKIT_EMAIL=${email}`,
    "-e",
    `JOBKIT_PASSWORD=${password}`,
  ]);
} finally {
  await stopServer();
}

async function prepareAccount() {
  let authResponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json", origin: baseUrl },
    method: "POST",
  });
  if (!authResponse.ok) {
    authResponse = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({ email, name: "Maestro Local", password }),
      headers: { "content-type": "application/json", origin: baseUrl },
      method: "POST",
    });
  }
  await requireOk(authResponse, "authenticate the local fixture account");
  const cookie = authResponse.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    throw new Error(
      "The local fixture account did not receive a session cookie"
    );
  }
  const headers = { "content-type": "application/json", cookie };
  const profile = {
    ...defaultProfile,
    citizenship: "United States",
    currentLocation: "Phoenix, United States",
    email,
    fullName: "Maestro Local",
    preferredName: "Maestro",
  };
  const preferences = {
    ...defaultPreferences,
    countries: { acceptable: [], excluded: [], preferred: ["Poland"] },
  };
  await Promise.all([
    requireOk(
      await fetch(`${baseUrl}/api/profile`, {
        body: JSON.stringify(profile),
        headers,
        method: "PUT",
      }),
      "save the local fixture profile"
    ),
    requireOk(
      await fetch(`${baseUrl}/api/preferences`, {
        body: JSON.stringify(preferences),
        headers,
        method: "PUT",
      }),
      "save the local fixture preferences"
    ),
  ]);
  await requireOk(
    await fetch(`${baseUrl}/api/onboarding/complete`, {
      headers: { cookie },
      method: "POST",
    }),
    "complete local fixture onboarding"
  );
}

async function requireOk(response: Response, action: string) {
  if (response.ok) {
    return;
  }
  throw new Error(
    `Could not ${action} (${response.status}): ${await response.text()}`
  );
}

async function waitForServer(attempt = 0): Promise<void> {
  if (server?.exitCode !== null) {
    throw new Error(`The development server exited with ${server?.exitCode}`);
  }
  if (attempt >= 80) {
    throw new Error(`The development server did not start at ${baseUrl}`);
  }
  try {
    const response = await fetch(baseUrl);
    if (response.ok) {
      return;
    }
  } catch {
    // The server is still starting.
  }
  await sleep(250);
  return waitForServer(attempt + 1);
}

async function startServer() {
  server = spawn(
    ["bun", "run", "dev", "--", "--host", host, "--port", String(port)],
    { stderr: "inherit", stdout: "inherit" }
  );
  await waitForServer();
}

async function stopServer() {
  if (!server) {
    return;
  }
  server.kill();
  await server.exited;
  server = null;
}

async function command(arguments_: string[]) {
  const process = spawn(arguments_, {
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${arguments_[0]} exited with ${exitCode}`);
  }
}
