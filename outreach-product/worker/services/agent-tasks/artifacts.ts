import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { AgentTaskError, type PreparedAgentTaskArtifact } from "./contracts";
import { readOwnedRunningAgentTask } from "./run-store";

interface DocumentArtifactRow {
  content_type: string;
  etag: string;
  filename: string;
  object_key: string;
  r2_version: string;
  size_bytes: number;
}

export async function attachDocumentArtifact(
  env: AppEnv,
  runner: AgentRunnerContext,
  runId: string,
  documentId: string,
  expected: { etag: string; version: string }
): Promise<PreparedAgentTaskArtifact> {
  const prepared = await prepareDocumentArtifact(
    env,
    runner.user.id,
    runId,
    documentId,
    expected
  );
  await prepared.write.statement.run();
  return prepared.artifact;
}

export async function prepareDocumentArtifact(
  env: AppEnv,
  userId: string,
  runId: string,
  documentId: string,
  expected: { etag: string; version: string }
) {
  const document = await env.DB.prepare(
    `SELECT filename,object_key,content_type,size_bytes,r2_version,etag
       FROM user_documents
      WHERE id=? AND user_id=? AND archived_at IS NULL`
  )
    .bind(documentId, userId)
    .first<DocumentArtifactRow>();
  if (!document) {
    throw new AgentTaskError("Document artifact was not found", 404);
  }
  const object = await env.DOCUMENTS.get(document.object_key);
  if (!object) {
    throw new AgentTaskError("Document artifact data was not found", 404);
  }
  if (
    document.r2_version !== expected.version ||
    document.etag !== expected.etag ||
    object.version !== document.r2_version ||
    object.etag !== document.etag
  ) {
    throw new AgentTaskError("Document artifact version changed", 409);
  }
  const sha256 = await digestBytes(await object.arrayBuffer());
  const artifactId = crypto.randomUUID();
  const artifact: PreparedAgentTaskArtifact = {
    contentType: document.content_type,
    filename: document.filename,
    id: artifactId,
    purpose: "document_ocr",
    sha256,
    sizeBytes: document.size_bytes,
    url: `/api/agent-tasks/${runId}/artifacts/${artifactId}`,
  };
  return {
    artifact,
    write: {
      expectedChanges: 1,
      statement: env.DB.prepare(
        `INSERT INTO agent_task_artifacts
          (id,run_id,user_id,object_key,filename,content_type,size_bytes,sha256,
           purpose,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      ).bind(
        artifact.id,
        runId,
        userId,
        document.object_key,
        document.filename,
        document.content_type,
        document.size_bytes,
        sha256,
        artifact.purpose
      ),
    },
  };
}

export async function readAgentTaskArtifact(
  env: AppEnv,
  runner: AgentRunnerContext,
  runId: string,
  artifactId: string
) {
  await readOwnedRunningAgentTask(env.DB, runner, runId);
  const artifact = await env.DB.prepare(
    `SELECT object_key,filename,content_type,size_bytes,sha256
       FROM agent_task_artifacts
      WHERE id=? AND run_id=? AND user_id=?`
  )
    .bind(artifactId, runId, runner.user.id)
    .first<{
      content_type: string;
      filename: string;
      object_key: string;
      sha256: string;
      size_bytes: number;
    }>();
  if (!artifact) {
    throw new AgentTaskError("Agent task artifact was not found", 404);
  }
  const object = await env.DOCUMENTS.get(artifact.object_key);
  if (!object?.body) {
    throw new AgentTaskError("Agent task artifact data was not found", 404);
  }
  return { artifact, object };
}

async function digestBytes(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
