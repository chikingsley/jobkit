import { spawn } from "node:child_process";

export interface CapturedProcess {
  code: number | null;
  stderr: string;
  stdout: string;
}

export interface CaptureProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs: number;
}

const BASE_ALLOWED_ENVIRONMENT = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
];

export function filteredEnvironment(options: {
  allowedKeys?: string[];
  allowedPrefixes?: string[];
}): NodeJS.ProcessEnv {
  const allowed = new Set([
    ...BASE_ALLOWED_ENVIRONMENT,
    ...(options.allowedKeys ?? []),
  ]);
  const prefixes = options.allowedPrefixes ?? [];
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (allowed.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    Reflect.deleteProperty(environment, key);
  }
  return environment;
}

export function captureProcess(
  executable: string,
  args: string[],
  options: CaptureProcessOptions
): Promise<CapturedProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!(child.stdin && child.stdout && child.stderr)) {
      reject(new Error(`${executable} did not expose expected streams`));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      operation();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new Error(
            `${executable} timed out after ${Math.round(options.timeoutMs / 1000)} seconds`
          )
        )
      );
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      finish(() => resolve({ code, stderr, stdout }));
    });
    child.stdin.end(options.input ?? "");
  });
}
