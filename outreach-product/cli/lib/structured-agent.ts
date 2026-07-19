import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface StructuredAgentOptions {
  artifacts?: StructuredAgentArtifact[];
  effort: "high" | "low" | "medium" | "xhigh";
  model: string;
  outputSchema: object;
  prompt: string;
  timeoutMs: number;
  webSearch: "disabled" | "live";
}

export interface StructuredAgentArtifact {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

export async function runStructuredAgent(options: StructuredAgentOptions) {
  const directory = await mkdtemp(join(tmpdir(), "jobkit-codex-task-"));
  const schemaPath = join(directory, "schema.json");
  const outputPath = join(directory, "output.json");
  try {
    await writeFile(
      schemaPath,
      `${JSON.stringify(options.outputSchema, null, 2)}\n`
    );
    const imagePaths = await prepareArtifactImages(
      directory,
      options.artifacts ?? []
    );
    const command = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--cd",
      directory,
      "--model",
      options.model,
      "--config",
      'approval_policy="never"',
      "--config",
      `model_reasoning_effort=${JSON.stringify(options.effort)}`,
      "--config",
      `web_search=${JSON.stringify(options.webSearch)}`,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
    ];
    for (const imagePath of imagePaths) {
      command.push("--image", imagePath);
    }
    command.push("-");
    await capture("codex", command, {
      cwd: directory,
      input: options.prompt,
      timeoutMs: options.timeoutMs,
    });
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function prepareArtifactImages(
  directory: string,
  artifacts: StructuredAgentArtifact[]
) {
  const imageGroups = await Promise.all(
    artifacts.map(async (artifact, artifactIndex) => {
      if (artifact.contentType === "application/pdf") {
        return renderPdfArtifact(directory, artifact.bytes, artifactIndex);
      }
      const extension = imageExtension(artifact.contentType);
      if (!extension) {
        throw new Error(
          `Codex vision does not accept ${artifact.contentType} artifacts`
        );
      }
      const imagePath = join(
        directory,
        `artifact-${String(artifactIndex + 1).padStart(3, "0")}.${extension}`
      );
      await writeFile(imagePath, artifact.bytes);
      return [imagePath];
    })
  );
  return imageGroups.flat();
}

async function renderPdfArtifact(
  directory: string,
  bytes: Uint8Array,
  artifactIndex: number
) {
  const { definePDFJSModule, getDocumentProxy, renderPageAsImage } =
    await import("unpdf");
  await definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
  const document = await getDocumentProxy(bytes);
  const imagePaths: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Ordered page rendering bounds peak memory and preserves document order.
    const image = await renderPageAsImage(document, pageNumber, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: 1.5,
    });
    const imagePath = join(
      directory,
      `artifact-${String(artifactIndex + 1).padStart(3, "0")}-page-${String(pageNumber).padStart(3, "0")}.png`
    );
    await writeFile(imagePath, new Uint8Array(image));
    imagePaths.push(imagePath);
  }
  return imagePaths;
}

function imageExtension(contentType: string) {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function capture(
  executable: string,
  args: string[],
  options: { cwd: string; input: string; timeoutMs: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: codexEnvironment(),
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
      finish(() => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(
          new Error(
            `${executable} exited ${code}: ${stderr.slice(-1000) || "no stderr"}`
          )
        );
      });
    });
    child.stdin.end(options.input);
  });
}

function codexEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set<string>([
    "CODEX_HOME",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TMPDIR",
    "USER",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ]);
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (!allowed.has(key)) {
      Reflect.deleteProperty(environment, key);
    }
  }
  return environment;
}
