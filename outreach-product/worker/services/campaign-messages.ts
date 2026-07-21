import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../src/agent-tasks/application-message";
import {
  type PreparedApplicationMessage,
  prepareApplicationMessageGeneration,
  prepareApplicationMessageRevision,
  validateCodexApplicationMessage,
} from "../ai/application-messages";
import type { AppEnv } from "../env";
import { readMessageStyleGuidance } from "../repositories/message-style";
import { type JobImport, JobImportSchema } from "../schemas";
import {
  buildAgentTaskRequestCreation,
  readActiveAgentTaskRequest,
} from "./agent-task-requests";
import {
  ANESL_REQUIRED_QUESTION,
  type ApplicationBundleTargetRow,
  aneslBundleJob,
} from "./application-bundle-model";
import {
  jobImportFromRow,
  messageContext,
  savedProfile,
} from "./application-drafts";

interface CampaignDispatchRow {
  campaign_id: string;
  campaign_status: string;
  channel: string;
  country_code: string;
  dedup_key: string;
  id: string;
  job_id: string | null;
  organization_id: string | null;
  route_strategy: "anesl_bundle" | "single";
  run_id: string | null;
  status: string;
  user_id: string;
}

interface CurrentCampaignMessage {
  id: string;
  message: string;
  version: number;
}

export type CampaignDispatchTaskInput = Extract<
  ApplicationMessageRequestInput,
  { kind: "campaign_dispatch" }
>;

export async function queueCampaignDispatchRevision(
  db: D1Database,
  userId: string,
  campaignId: string,
  dispatchId: string,
  instruction: string,
  scope: "campaign" | "future" | "message"
) {
  const dispatch = await readDispatch(db, userId, dispatchId);
  if (dispatch.campaign_id !== campaignId) {
    throw new Error("Campaign dispatch was not found");
  }
  const current = await readCurrentCampaignMessage(db, dispatchId);
  if (!current) {
    throw new Error(
      "Wait for Codex to prepare this message before revising it"
    );
  }
  const active = await readActiveAgentTaskRequest(db, {
    subjectId: dispatchId,
    subjectType: "campaign_dispatch",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  if (active) {
    return active;
  }
  const taskCreation = buildAgentTaskRequestCreation(db, {
    payload: {
      dispatchId,
      expectedMessageId: current.id,
      instruction,
      kind: "campaign_dispatch",
      mode: "revise",
    } satisfies CampaignDispatchTaskInput,
    subjectId: dispatchId,
    subjectType: "campaign_dispatch",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  const timestamp = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO campaign_guidance
          (id,campaign_id,source_dispatch_id,instruction,scope,status,
           created_at,decided_at)
         VALUES (?,?,?,?,?,'accepted',?,?)`
      )
      .bind(
        crypto.randomUUID(),
        campaignId,
        dispatchId,
        instruction,
        scope,
        timestamp,
        timestamp
      ),
    taskCreation.statement,
    db
      .prepare(
        `UPDATE campaign_dispatches SET status='drafting',updated_at=?
          WHERE id=? AND campaign_id=? AND status IN ('review','calibration')`
      )
      .bind(timestamp, dispatchId, campaignId),
  ];
  if (scope === "future") {
    statements.push(
      ...(await futureGuidanceStatements(db, userId, instruction))
    );
  }
  await db.batch(statements);
  return taskCreation.request;
}

export async function approveCampaignDispatch(
  db: D1Database,
  userId: string,
  campaignId: string,
  dispatchId: string
) {
  const dispatch = await readDispatch(db, userId, dispatchId);
  if (dispatch.campaign_id !== campaignId) {
    throw new Error("Campaign dispatch was not found");
  }
  const current = await readCurrentCampaignMessage(db, dispatchId);
  if (!current) {
    throw new Error("The campaign message has not been prepared");
  }
  const timestamp = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE campaign_messages SET status='approved',approved_at=?
          WHERE id=? AND dispatch_id=? AND status='draft'`
      )
      .bind(timestamp, current.id, dispatchId),
    db
      .prepare(
        `UPDATE campaign_dispatches SET status='ready',updated_at=?
          WHERE id=? AND campaign_id=? AND status='review'`
      )
      .bind(timestamp, dispatchId, campaignId),
    db
      .prepare(
        `UPDATE campaign_targets SET status='approved',updated_at=?
          WHERE id IN (
            SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
          ) AND status='drafted'`
      )
      .bind(timestamp, dispatchId),
  ]);
  if (results.slice(0, 2).some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("The campaign message changed before it could be approved");
  }
  const remaining = await db
    .prepare(
      `SELECT COUNT(*) count FROM campaign_dispatches
        WHERE campaign_id=? AND status IN ('calibration','drafting','review')`
    )
    .bind(campaignId)
    .first<number>("count");
  if (Number(remaining ?? 0) === 0) {
    await db
      .prepare(
        `UPDATE campaigns
            SET status='ready',first_five_completed_at=?,updated_at=?
          WHERE id=? AND user_id=? AND status='calibrating'`
      )
      .bind(timestamp, timestamp, campaignId, userId)
      .run();
  }
}

export async function prepareCampaignDispatchTask(
  env: AppEnv,
  userId: string,
  input: CampaignDispatchTaskInput
) {
  const dispatch = await readDispatch(env.DB, userId, input.dispatchId);
  const [profile, job, styleGuidance, acceptedGuidance, current] =
    await Promise.all([
      savedProfile(env.DB, userId),
      campaignDispatchJob(env.DB, dispatch),
      readMessageStyleGuidance(env.DB, userId),
      readAcceptedCampaignGuidance(env.DB, dispatch.campaign_id),
      readCurrentCampaignMessage(env.DB, input.dispatchId),
    ]);
  const context = await messageContext(
    env,
    userId,
    job,
    dispatch.organization_id || dispatch.route_strategy === "anesl_bundle"
      ? { audience: "general", length: "long" }
      : undefined
  );
  if (dispatch.route_strategy === "anesl_bundle") {
    context.requiredPositionReferences = await campaignDispatchReferences(
      env.DB,
      dispatch.id
    );
    context.requiredQuestion = ANESL_REQUIRED_QUESTION;
  }
  const allGuidance = [...styleGuidance, ...acceptedGuidance];
  let prepared: PreparedApplicationMessage;
  if (input.mode === "revise") {
    if (!(current && current.id === input.expectedMessageId)) {
      throw new Error(
        "The campaign message changed before Codex could revise it"
      );
    }
    prepared = prepareApplicationMessageRevision(
      job,
      profile,
      current.message,
      input.instruction ?? "",
      allGuidance,
      context
    );
  } else {
    if (current) {
      throw new Error("This campaign dispatch already has a message");
    }
    prepared = prepareApplicationMessageGeneration(
      job,
      profile,
      allGuidance,
      context
    );
  }
  return {
    current,
    dispatch,
    job,
    prepared,
    recipient: await campaignDispatchRecipient(env.DB, dispatch),
  };
}

export async function buildCampaignDispatchTaskCompletion(
  env: AppEnv,
  userId: string,
  input: CampaignDispatchTaskInput,
  rawOutput: unknown,
  modelId: string
) {
  const state = await prepareCampaignDispatchTask(env, userId, input);
  const generated = validateCodexApplicationMessage(
    rawOutput,
    state.prepared,
    modelId
  );
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = (state.current?.version ?? 0) + 1;
  const revisionSource = state.current ? "ai_revision" : "generated";
  const subject = applicationSubject(state.job);
  const automated =
    state.dispatch.campaign_status === "running" &&
    state.dispatch.status === "queued";
  return {
    result: {
      dispatchId: input.dispatchId,
      message: {
        changeSummary: generated.summary,
        createdAt: timestamp,
        id,
        message: generated.message,
        status: "draft" as const,
        version,
      },
    },
    statements: [
      env.DB.prepare(
        `UPDATE campaign_messages SET status='superseded'
          WHERE dispatch_id=? AND status='draft'`
      ).bind(input.dispatchId),
      env.DB.prepare(
        `INSERT INTO campaign_messages
          (id,dispatch_id,version,message,change_summary,
           revision_instruction,revision_source,status,model_id,created_at,
           approved_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id,
        input.dispatchId,
        version,
        generated.message,
        generated.summary,
        input.instruction ?? "",
        revisionSource,
        automated ? "approved" : "draft",
        generated.modelId,
        timestamp,
        automated ? timestamp : null
      ),
      env.DB.prepare(
        `UPDATE campaign_dispatches
            SET recipient=?,subject=?,status=?,updated_at=?
          WHERE id=? AND campaign_id=?
            AND status IN ('calibration','queued','drafting','review')`
      ).bind(
        state.recipient,
        subject,
        automated ? "ready" : "review",
        timestamp,
        input.dispatchId,
        state.dispatch.campaign_id
      ),
      env.DB.prepare(
        `UPDATE campaign_targets SET status=?,updated_at=?
          WHERE id IN (
            SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
          ) AND status IN ('calibration','claimed','drafted')`
      ).bind(automated ? "approved" : "drafted", timestamp, input.dispatchId),
      env.DB.prepare(
        `UPDATE campaign_runs SET status='delivering',updated_at=?
          WHERE id=? AND status='generating'
            AND NOT EXISTS (
              SELECT 1 FROM campaign_dispatches pending
               WHERE pending.run_id=campaign_runs.id
                 AND pending.id<>?
                 AND pending.status IN ('queued','drafting')
            )`
      ).bind(timestamp, state.dispatch.run_id ?? "", input.dispatchId),
    ],
  };
}

async function readDispatch(
  db: D1Database,
  userId: string,
  dispatchId: string
) {
  const row = await db
    .prepare(
      `SELECT d.id,d.campaign_id,d.run_id,d.dedup_key,d.route_strategy,
              d.channel,d.status,c.status campaign_status,c.user_id,
              t.country_code,t.job_id,t.organization_id
         FROM campaign_dispatches d
         JOIN campaigns c ON c.id=d.campaign_id
         JOIN campaign_dispatch_targets dt ON dt.dispatch_id=d.id
         JOIN campaign_targets t ON t.id=dt.target_id
        WHERE d.id=? AND c.user_id=?
        ORDER BY dt.ordinal LIMIT 1`
    )
    .bind(dispatchId, userId)
    .first<CampaignDispatchRow>();
  if (!row) {
    throw new Error("Campaign dispatch was not found");
  }
  return row;
}

function readCurrentCampaignMessage(db: D1Database, dispatchId: string) {
  return db
    .prepare(
      `SELECT id,version,message FROM campaign_messages
        WHERE dispatch_id=? AND status='draft'
        ORDER BY version DESC LIMIT 1`
    )
    .bind(dispatchId)
    .first<CurrentCampaignMessage>();
}

async function readAcceptedCampaignGuidance(
  db: D1Database,
  campaignId: string
) {
  const rows = await db
    .prepare(
      `SELECT instruction FROM campaign_guidance
        WHERE campaign_id=? AND status='accepted' AND scope IN ('campaign','future')
        ORDER BY created_at`
    )
    .bind(campaignId)
    .all<{ instruction: string }>();
  return rows.results.map((row) => row.instruction);
}

async function campaignDispatchJob(
  db: D1Database,
  dispatch: CampaignDispatchRow
): Promise<JobImport> {
  if (dispatch.route_strategy === "anesl_bundle") {
    const rows = await db
      .prepare(
        `SELECT j.*,0 priority,j.source_reference,j.title,j.location
           FROM campaign_dispatch_targets dt
           JOIN campaign_targets t ON t.id=dt.target_id
           JOIN job_listings j ON j.id=t.job_id
          WHERE dt.dispatch_id=? ORDER BY dt.ordinal`
      )
      .bind(dispatch.id)
      .all<ApplicationBundleTargetRow>();
    if (rows.results.length === 0) {
      throw new Error("ANESL campaign targets were not found");
    }
    return aneslBundleJob(dispatch.id, rows.results);
  }
  if (dispatch.job_id) {
    const row = await db
      .prepare("SELECT *,0 priority FROM job_listings WHERE id=?")
      .bind(dispatch.job_id)
      .first<Record<string, unknown>>();
    if (!row) {
      throw new Error("Campaign job was not found");
    }
    return jobImportFromRow(row);
  }
  const organization = await db
    .prepare(
      `SELECT o.id,o.name,o.country_name,o.city,o.region,o.website_url,
              o.canonical_domain,o.market_segment,o.evidence_url,
              cp.value recipient
         FROM organizations o
         JOIN campaign_targets t ON t.organization_id=o.id
         JOIN campaign_dispatch_targets dt ON dt.target_id=t.id
         JOIN organization_contact_points cp ON cp.id=t.contact_point_id
        WHERE dt.dispatch_id=?
        ORDER BY dt.ordinal LIMIT 1`
    )
    .bind(dispatch.id)
    .first<Record<string, unknown>>();
  if (!organization) {
    throw new Error("Campaign school was not found");
  }
  const website = String(
    organization.website_url || organization.evidence_url || ""
  );
  return JobImportSchema.parse({
    applyEmail: organization.recipient,
    applyUrl: website,
    board: "direct_school_outreach",
    company: organization.name,
    contactName: "",
    country: organization.country_name,
    description: [
      `${organization.name} is a ${String(organization.market_segment).replaceAll("_", " ")} in ${[organization.city, organization.region, organization.country_name].filter(Boolean).join(", ")}.`,
      website ? `Official source: ${website}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    employerId: organization.id,
    id: `campaign-school:${organization.id}`,
    location: [organization.city, organization.region]
      .filter(Boolean)
      .join(", "),
    marketSegments: [organization.market_segment],
    messageRoute: "school_outreach",
    opportunityScope: "direct",
    priority: 0,
    salary: "",
    sourceUrl: website,
    title: `English teaching outreach to ${organization.name}`,
  });
}

async function campaignDispatchReferences(db: D1Database, dispatchId: string) {
  const rows = await db
    .prepare(
      `SELECT j.source_reference
         FROM campaign_dispatch_targets dt
         JOIN campaign_targets t ON t.id=dt.target_id
         JOIN job_listings j ON j.id=t.job_id
        WHERE dt.dispatch_id=? ORDER BY dt.ordinal`
    )
    .bind(dispatchId)
    .all<{ source_reference: string }>();
  return rows.results.map((row) => row.source_reference).filter(Boolean);
}

async function campaignDispatchRecipient(
  db: D1Database,
  dispatch: CampaignDispatchRow
) {
  const row = await db
    .prepare(
      `SELECT COALESCE(ar.destination,cp.value,'') recipient
         FROM campaign_dispatch_targets dt
         JOIN campaign_targets t ON t.id=dt.target_id
         LEFT JOIN application_routes ar ON ar.id=t.route_id
         LEFT JOIN organization_contact_points cp ON cp.id=t.contact_point_id
        WHERE dt.dispatch_id=? ORDER BY dt.ordinal LIMIT 1`
    )
    .bind(dispatch.id)
    .first<{ recipient: string }>();
  return row?.recipient ?? "";
}

function applicationSubject(job: JobImport) {
  const place = (job.location || job.country).replace(/[\r\n]+/gu, " ").trim();
  return `Native English Teacher Available${place ? ` - ${place}` : ""}`.slice(
    0,
    180
  );
}

async function futureGuidanceStatements(
  db: D1Database,
  userId: string,
  instruction: string
) {
  const active = await db
    .prepare(
      `SELECT id,version,name,voice_rules_json,templates_json
         FROM user_message_foundations
        WHERE user_id=? AND status='active' LIMIT 1`
    )
    .bind(userId)
    .first<{
      id: string;
      name: string;
      templates_json: string;
      version: number;
      voice_rules_json: string;
    }>();
  if (!active) {
    return [];
  }
  const rules = JSON.parse(active.voice_rules_json) as string[];
  if (!rules.includes(instruction)) {
    rules.push(instruction);
  }
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  return [
    db
      .prepare(
        `UPDATE user_message_foundations SET status='archived'
          WHERE id=? AND user_id=? AND status='active'`
      )
      .bind(active.id, userId),
    db
      .prepare(
        `INSERT INTO user_message_foundations
          (id,user_id,version,name,status,voice_rules_json,templates_json,
           created_at,activated_at)
         VALUES (?,?,?,?,'active',?,?,?,?)`
      )
      .bind(
        id,
        userId,
        active.version + 1,
        active.name,
        JSON.stringify(rules),
        active.templates_json,
        timestamp,
        timestamp
      ),
  ];
}
