import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureDocumentPackets,
  listDocumentPackets,
  setDefaultDocumentPacket,
} from "../../../worker/repositories/document-packets";
import { defaultPacketSnapshotStatements } from "../../../worker/repositories/draft-attachments";
import { buildGmailMessagePayload } from "../../../worker/services/gmail-message";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("versioned document delivery", () => {
  it("snapshots the exact visa packet and builds a Gmail multipart payload", async () => {
    const { userId } = await createAuthenticatedUser(
      "document-delivery@example.test"
    );
    const timestamp = new Date().toISOString();
    const categories = ["resume", "degree", "tefl", "passport", "photo"];
    for (const category of categories) {
      const documentId = crypto.randomUUID();
      const filename = `${category}.pdf`;
      const objectKey = `users/${userId}/${documentId}/${filename}`;
      const object = await testEnv.DOCUMENTS.put(
        objectKey,
        new TextEncoder().encode(`exact-${category}`),
        { httpMetadata: { contentType: "application/pdf" } }
      );
      await testEnv.DB.prepare(
        `INSERT INTO user_documents
          (id,user_id,category,filename,object_key,content_type,size_bytes,
           r2_version,etag,created_at)
         VALUES (?,?,?,?,?,'application/pdf',?,?,?,?)`
      )
        .bind(
          documentId,
          userId,
          category,
          filename,
          objectKey,
          `exact-${category}`.length,
          object?.version ?? "",
          object?.etag ?? "",
          timestamp
        )
        .run();
    }

    await ensureDocumentPackets(testEnv.DB, userId);
    const packets = await listDocumentPackets(testEnv.DB, userId);
    const visaPacket = packets.find((packet) => packet.slug === "visa-market");
    if (!visaPacket) {
      throw new Error("Visa packet was not created");
    }
    await setDefaultDocumentPacket(testEnv.DB, userId, visaPacket.id);

    const jobId = crypto.randomUUID();
    const userJobId = crypto.randomUUID();
    const draftId = crypto.randomUUID();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO jobs (id,title,apply_url,first_seen_at,updated_at)
         VALUES (?,'English Teacher','mailto:school@example.test',?,?)`
      ).bind(jobId, timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO user_jobs (id,user_id,job_id,status,created_at,updated_at)
         VALUES (?,?,?,'review',?,?)`
      ).bind(userJobId, userId, jobId, timestamp, timestamp),
    ]);
    const snapshot = await defaultPacketSnapshotStatements(
      testEnv,
      userId,
      draftId,
      timestamp
    );
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,version,message,created_at)
         VALUES (?,?,1,'Hello,\n\nI am available to teach.\n\nWhat would the weekly schedule look like?\n\nBest,\nTest Candidate',?)`
      ).bind(draftId, userJobId, timestamp),
      ...snapshot,
    ]);

    const payload = await buildGmailMessagePayload(testEnv, userId, draftId, {
      from: "Test Candidate <candidate@example.test>",
      subject: "Native English Teacher Available - Test City",
      to: "school@example.test",
    });
    const decoded = decodeBase64Url(payload.raw);

    expect(payload.attachmentCount).toBe(5);
    expect(payload.filenames).toEqual(categories.map((item) => `${item}.pdf`));
    expect(decoded).toContain("Content-Type: multipart/mixed");
    for (const category of categories) {
      expect(decoded).toContain(`filename="${category}.pdf"`);
    }
    expect(
      await testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM application_draft_attachments WHERE draft_id=? AND r2_version<>'' AND etag<>''"
      )
        .bind(draftId)
        .first()
    ).toEqual({ count: 5 });
    expect(
      await testEnv.DB.prepare(
        "SELECT document_packet_slug,document_packet_manifest_json FROM application_drafts WHERE id=?"
      )
        .bind(draftId)
        .first()
    ).toEqual({
      document_packet_manifest_json:
        '["resume","degree","tefl","passport","photo"]',
      document_packet_slug: "visa-market",
    });

    await testEnv.DB.prepare(
      "DELETE FROM application_draft_attachments WHERE draft_id=? AND category='photo'"
    )
      .bind(draftId)
      .run();
    await expect(
      buildGmailMessagePayload(testEnv, userId, draftId, {
        from: "Test Candidate <candidate@example.test>",
        subject: "Native English Teacher Available - Test City",
        to: "school@example.test",
      })
    ).rejects.toThrow("attachment packet is incomplete: photo");
  });
});

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}
