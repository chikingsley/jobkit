import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { listAneslPositions } from "../../../worker/services/application-bundle-candidates";
import {
  ensureSelectedAneslUserJobs,
  readSelectedAneslTargets,
} from "../../../worker/services/application-bundle-model";
import { listAneslApplicationSets } from "../../../worker/services/application-bundle-view";
import {
  claimEmailAttempt,
  createApprovedBundleEmailAttempt,
  createApprovedEmailAttempt,
  recordGmailDraft,
  recordGmailSent,
  reserveGmailSend,
} from "../../../worker/services/email-attempts";
import { recordInboundMessage } from "../../../worker/services/messages";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-18T00:00:00.000Z";
const recipient = "hr@anesl.com";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("ANESL application sets", () => {
  it("lists global ANESL inventory and creates user records only when selected", async () => {
    const { userId } = await createAuthenticatedUser(
      "anesl-candidates@example.test"
    );
    const contactChannelId = await seedAneslContact();
    const position = await seedPosition(
      userId,
      contactChannelId,
      "BJ0001",
      "Global ANESL role"
    );
    await env.DB.batch([
      env.DB.prepare("DELETE FROM application_drafts WHERE user_job_id=?").bind(
        position.userJobId
      ),
      env.DB.prepare("DELETE FROM user_jobs WHERE id=?").bind(
        position.userJobId
      ),
    ]);

    await expect(
      listAneslPositions(env.DB, userId, {
        limit: 100,
        offset: 0,
        query: "BJ0001",
      })
    ).resolves.toMatchObject({
      hasMore: false,
      positions: [{ id: position.jobId, sourceReference: "BJ0001" }],
      total: 1,
    });

    await ensureSelectedAneslUserJobs(env.DB, userId, [position.jobId]);
    await expect(
      readSelectedAneslTargets(env.DB, userId, [position.jobId])
    ).resolves.toMatchObject([
      { source_reference: "BJ0001", user_job_status: "new" },
    ]);
  });

  it("sends selected positions as one attempt and applies every target", async () => {
    const { userId } = await createAuthenticatedUser(
      "anesl-bundle@example.test"
    );
    const contactChannelId = await seedAneslContact();
    const first = await seedPosition(
      userId,
      contactChannelId,
      "BJ1001",
      "University English teacher"
    );
    const second = await seedPosition(
      userId,
      contactChannelId,
      "SH2002",
      "Secondary school English teacher"
    );
    const bundleId = "anesl-bundle-1";
    const draftId = "anesl-bundle-draft-1";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO application_bundles
          (id,user_id,kind,contact_channel_id,recipient,subject,status,
           created_at,updated_at)
         VALUES (?,?,'anesl_positions',?,?,?,'review',?,?)`
      ).bind(
        bundleId,
        userId,
        contactChannelId,
        recipient,
        "Native English Teacher Application - BJ1001, SH2002",
        timestamp,
        timestamp
      ),
      targetStatement(bundleId, first, 0),
      targetStatement(bundleId, second, 1),
      env.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,application_bundle_id,version,message,required_opening,
           status,created_at)
         VALUES (?,?,?,2,?,?,'draft',?)`
      ).bind(
        draftId,
        first.userJobId,
        bundleId,
        `Hello Mr. Yang,

I am a qualified English teacher interested in positions BJ1001 and SH2002.

Would you be open to talking about which of these positions and locations you are currently recruiting for?

Best,
Integration User`,
        "Hello Mr. Yang,",
        timestamp
      ),
    ]);

    const attempt = await createApprovedBundleEmailAttempt(
      env,
      userId,
      bundleId,
      draftId
    );
    expect(attempt).toMatchObject({
      bundleId,
      recipient,
      status: "approved",
      subject: "Native English Teacher Application - BJ1001, SH2002",
    });
    await claimEmailAttempt(env, userId, attempt.attemptId);
    await recordGmailDraft(
      env.DB,
      userId,
      attempt.attemptId,
      "gmail-bundle-draft",
      "gmail-bundle-draft-message"
    );
    await reserveGmailSend(
      env.DB,
      userId,
      attempt.attemptId,
      "gmail-bundle-draft"
    );
    await recordGmailSent(
      env.DB,
      userId,
      attempt.attemptId,
      "gmail-bundle-draft",
      "gmail-bundle-message",
      "gmail-bundle-thread"
    );

    expect(
      await env.DB.prepare(
        `SELECT status,COUNT(*) count FROM user_jobs
          WHERE id IN (?,?) GROUP BY status`
      )
        .bind(first.userJobId, second.userJobId)
        .first()
    ).toEqual({ count: 2, status: "applied" });
    expect(
      await env.DB.prepare("SELECT status FROM application_bundles WHERE id=?")
        .bind(bundleId)
        .first()
    ).toEqual({ status: "sent" });
    expect(await listAneslApplicationSets(env.DB, userId)).toMatchObject([
      {
        attempt: { status: "sent" },
        status: "sent",
        targets: [{ sourceReference: "BJ1001" }, { sourceReference: "SH2002" }],
      },
    ]);
  });

  it("blocks a later batch to a recipient already contacted", async () => {
    const { userId } = await createAuthenticatedUser(
      "anesl-repeat@example.test"
    );
    const contactChannelId = await seedAneslContact();
    const first = await seedPosition(
      userId,
      contactChannelId,
      "BJ3003",
      "First ANESL role"
    );
    const second = await seedPosition(
      userId,
      contactChannelId,
      "GZ4004",
      "Later ANESL role"
    );
    const firstAttempt = await createApprovedEmailAttempt(
      env,
      userId,
      first.jobId,
      first.draftId,
      first.routeId
    );
    await claimEmailAttempt(env, userId, firstAttempt.attemptId);
    await recordGmailDraft(
      env.DB,
      userId,
      firstAttempt.attemptId,
      "first-draft",
      "first-draft-message"
    );
    await reserveGmailSend(
      env.DB,
      userId,
      firstAttempt.attemptId,
      "first-draft"
    );
    await recordGmailSent(
      env.DB,
      userId,
      firstAttempt.attemptId,
      "first-draft",
      "first-message",
      "first-thread"
    );

    await expect(
      createApprovedEmailAttempt(
        env,
        userId,
        second.jobId,
        second.draftId,
        second.routeId
      )
    ).rejects.toThrow(
      "This recipient already has an active or sent outreach message"
    );
  });

  it("records a bundle test reply when Gmail uses a recipient-side thread ID", async () => {
    const { userId } = await createAuthenticatedUser(
      "anesl-test-reply@example.test"
    );
    const contactChannelId = await seedAneslContact();
    const position = await seedPosition(
      userId,
      contactChannelId,
      "BJ5005",
      "Kindergarten English teacher"
    );
    const bundleId = "anesl-test-reply-bundle";
    const subject = "[TEST] Native English Teacher Application - BJ5005";
    const testSendId = "anesl-test-send-1";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO application_bundles
          (id,user_id,kind,contact_channel_id,recipient,subject,status,
           created_at,updated_at)
         VALUES (?,?,'anesl_positions',?,?,?,'review',?,?)`
      ).bind(
        bundleId,
        userId,
        contactChannelId,
        recipient,
        "Native English Teacher Application - BJ5005",
        timestamp,
        timestamp
      ),
      targetStatement(bundleId, position, 0),
      env.DB.prepare(
        "UPDATE application_drafts SET application_bundle_id=? WHERE id=?"
      ).bind(bundleId, position.draftId),
      env.DB.prepare(
        `INSERT INTO application_bundle_test_sends
          (id,bundle_id,draft_id,recipient,subject,status,gmail_message_id,
           gmail_thread_id,sent_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'sent',?,?,?,?,?)`
      ).bind(
        testSendId,
        bundleId,
        position.draftId,
        "cheez2012@gmail.com",
        subject,
        "sender-message-id",
        "sender-mailbox-thread-id",
        timestamp,
        timestamp,
        timestamp
      ),
    ]);

    await expect(
      recordInboundMessage(env.DB, userId, {
        bodyText: "The test bundle and its five attachments arrived.",
        fromAddress: "Test Recipient <cheez2012@gmail.com>",
        gmailMessageId: "recipient-reply-message-id",
        gmailThreadId: "recipient-mailbox-thread-id",
        sentAt: timestamp,
        subject: `Re: ${subject}`,
        testSendId,
        toAddress: "chibuzor.ejimofor@gmail.com",
      })
    ).resolves.toEqual({ created: true });
    await expect(
      env.DB.prepare(
        `SELECT gmail_thread_id,subject,body_text
           FROM application_thread_messages WHERE gmail_message_id=?`
      )
        .bind("recipient-reply-message-id")
        .first()
    ).resolves.toEqual({
      body_text: "The test bundle and its five attachments arrived.",
      gmail_thread_id: "recipient-mailbox-thread-id",
      subject: `Re: ${subject}`,
    });
    await expect(
      env.DB.prepare(
        `SELECT reply_received_at FROM application_bundle_test_sends
          WHERE id=?`
      )
        .bind(testSendId)
        .first()
    ).resolves.toEqual({ reply_received_at: timestamp });
  });
});

interface SeededPosition {
  draftId: string;
  jobId: string;
  location: string;
  reference: string;
  routeId: string;
  title: string;
  userJobId: string;
}

async function seedAneslContact() {
  const contactId = "contact:anesl-test";
  const channelId = "contact-channel:anesl-test";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO contacts
        (id,display_name,organization_name,role,status,created_at,updated_at)
       VALUES (?,'Mr. Corey Yang','ANESL','board_intermediary','active',?,?)`
    ).bind(contactId, timestamp, timestamp),
    env.DB.prepare(
      `INSERT OR IGNORE INTO contact_channels
        (id,contact_id,kind,value,normalized_value,status,created_at,updated_at)
       VALUES (?,?,'email',?,?,'active',?,?)`
    ).bind(channelId, contactId, recipient, recipient, timestamp, timestamp),
  ]);
  return channelId;
}

async function seedPosition(
  userId: string,
  contactChannelId: string,
  reference: string,
  title: string
): Promise<SeededPosition> {
  const jobId = `anesl:${reference}`;
  const userJobId = `user-job:${reference}`;
  const draftId = `draft:${reference}`;
  const routeId = `route:${reference}`;
  const location = "China";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs
        (id,board,title,company,country,location,source_url,apply_url,
         contact_name,source_reference,first_seen_at,updated_at)
       VALUES (?,'anesl',?,'ANESL','China',?,?,?,?,?,?,?)`
    ).bind(
      jobId,
      title,
      location,
      `https://example.test/${reference}`,
      `https://example.test/${reference}`,
      "Mr. Corey Yang",
      reference,
      timestamp,
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO user_jobs
        (id,user_id,job_id,status,created_at,updated_at)
       VALUES (?,?,?,'review',?,?)`
    ).bind(userJobId, userId, jobId, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,required_opening,status,created_at)
       VALUES (?,?,1,?,?,'draft',?)`
    ).bind(
      draftId,
      userJobId,
      `Hello Mr. Yang,

I am interested in ${reference}.

Would you be free to speak about the role?

Best,
Integration User`,
      "Hello Mr. Yang,",
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,contact_channel_id,source_evidence,
         last_verified_at,status,created_at,updated_at)
       VALUES (?,?,'email',?,?,?,?,'active',?,?)`
    ).bind(
      routeId,
      jobId,
      recipient,
      contactChannelId,
      `https://example.test/${reference}`,
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
  return { draftId, jobId, location, reference, routeId, title, userJobId };
}

function targetStatement(
  bundleId: string,
  position: SeededPosition,
  ordinal: number
) {
  return env.DB.prepare(
    `INSERT INTO application_bundle_targets
      (bundle_id,user_job_id,route_id,ordinal,source_reference,title,location)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(
    bundleId,
    position.userJobId,
    position.routeId,
    ordinal,
    position.reference,
    position.title,
    position.location
  );
}
