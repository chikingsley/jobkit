import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { file, Glob, sleep, spawn } from "bun";
import { defaultPreferences } from "../../src/features/preferences/schema";
import { defaultProfile } from "../../src/features/profile/schema";

const host = "127.0.0.1";
const port = 4177;
const baseUrl = `http://${host}:${port}`;
const email = "maestro.local@jobkit.test";
const password = "maestro-local-password";
const flowTag = process.argv[2] ?? "safe";
const screenSize = process.env.JOBKIT_SCREEN_SIZE ?? "1366x900";
const maestro = join(process.env.HOME ?? "", ".maestro", "bin", "maestro");
const persistencePath = resolve("test-results/maestro/state");
const tagLinePattern = /^\s+-\s+(.+?)\s*$/;
const yamlExtensionPattern = /\.yaml$/;
const flowFiles = await matchingFlowFiles(flowTag);
let server: ReturnType<typeof spawn> | null = null;

if (flowFiles.length === 0) {
  throw new Error(`No Maestro flows have the tag ${flowTag}`);
}

try {
  await rm(persistencePath, { force: true, recursive: true });
  await command([
    "bunx",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "jobkit-outreach",
    "--local",
    "--persist-to",
    persistencePath,
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
    "--persist-to",
    persistencePath,
  ]);
  await startServer();
  await flowFiles.reduce(
    (previous, flowFile) =>
      previous.then(async () => {
        await runFlow(flowFile);
      }),
    Promise.resolve()
  );
} finally {
  await stopServer();
}

async function matchingFlowFiles(tag: string) {
  const files = Array.from(
    new Glob("*.yaml").scanSync({ cwd: ".maestro/flows" })
  ).sort();
  const candidates = await Promise.all(
    files.map(async (fileName) => {
      const flowFile = join(".maestro/flows", fileName);
      const header = (await file(flowFile).text()).split("---", 1)[0] ?? "";
      const tags = header
        .split("\n")
        .map((line) => tagLinePattern.exec(line)?.[1])
        .filter((value): value is string => value !== undefined);
      return { flowFile, tags };
    })
  );
  return candidates
    .filter(({ tags }) => tags.includes(tag))
    .map(({ flowFile }) => flowFile);
}

function flowName(flowFile: string) {
  return (
    flowFile.split("/").at(-1)?.replace(yamlExtensionPattern, "") ?? "flow"
  );
}

async function runFlow(flowFile: string) {
  await command([
    maestro,
    "test",
    flowFile,
    "--config",
    ".maestro/config.yaml",
    "--headless",
    "--screen-size",
    screenSize,
    "--test-output-dir",
    join("test-results/maestro", flowName(flowFile)),
    "-e",
    `JOBKIT_URL=${baseUrl}`,
    "-e",
    `JOBKIT_EMAIL=${email}`,
    "-e",
    `JOBKIT_PASSWORD=${password}`,
  ]);
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
  const resume = new TextEncoder().encode("%PDF-1.4 Maestro resume fixture");
  await requireOk(
    await fetch(`${baseUrl}/api/documents`, {
      body: resume,
      headers: {
        "content-length": String(resume.byteLength),
        "content-type": "application/pdf",
        cookie,
        "x-jobkit-category": "resume",
        "x-jobkit-filename": "maestro-resume.pdf",
      },
      method: "PUT",
    }),
    "save the local fixture resume"
  );
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
    {
      env: { ...process.env, JOBKIT_PERSIST_STATE: persistencePath },
      stderr: "inherit",
      stdout: "inherit",
    }
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
