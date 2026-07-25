import { type JobImport, JobImportSchema } from "../../../../worker/schemas";
import type { AgentTaskCompletionFence } from "../../../../worker/services/agent-tasks/run-store";
import {
  type ApplicationBundleTargetRow,
  aneslBundleJob,
} from "../../06_deliver/application-bundle-model";
import { jobImportFromRow } from "../application-drafts";
import type {
  CampaignDispatchRow,
  CurrentCampaignMessage,
} from "../campaign-messages";

export function requireCampaignRevisionGuidance(
  guidance:
    | { instruction: string; scope: "campaign" | "future" | "message" }
    | null
    | undefined
) {
  if (!guidance) {
    throw new Error(
      "Campaign revision output must classify the user's feedback"
    );
  }
  return guidance;
}

export async function readDispatch(
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

export function readCurrentCampaignMessage(db: D1Database, dispatchId: string) {
  return db
    .prepare(
      `SELECT id,version,message FROM campaign_messages
        WHERE dispatch_id=? AND status='draft'
        ORDER BY version DESC LIMIT 1`
    )
    .bind(dispatchId)
    .first<CurrentCampaignMessage>();
}

export async function readCampaignDispatchTargetCount(
  db: D1Database,
  dispatchId: string
) {
  const count = await db
    .prepare(
      "SELECT COUNT(*) count FROM campaign_dispatch_targets WHERE dispatch_id=?"
    )
    .bind(dispatchId)
    .first<number>("count");
  return Number(count ?? 0);
}

export async function readAcceptedCampaignGuidance(
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

export async function campaignDispatchJob(
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

export async function campaignDispatchReferences(
  db: D1Database,
  dispatchId: string
) {
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

export async function campaignDispatchRecipient(
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

export function applicationSubject(job: JobImport) {
  const place = (job.location || job.country).replace(/[\r\n]+/gu, " ").trim();
  return `Native English Teacher Available${place ? ` - ${place}` : ""}`.slice(
    0,
    180
  );
}

export async function futureGuidanceWrites(
  db: D1Database,
  userId: string,
  instruction: string,
  fence: AgentTaskCompletionFence
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
    return { condition: null, writes: [] };
  }
  const rules = JSON.parse(active.voice_rules_json) as string[];
  if (!rules.includes(instruction)) {
    rules.push(instruction);
  }
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  return {
    condition: {
      clause: `EXISTS (
        SELECT 1 FROM user_message_foundations completion_foundation
         WHERE completion_foundation.id=?
           AND completion_foundation.user_id=?
           AND completion_foundation.version=?
           AND completion_foundation.status='active'
      )`,
      values: [active.id, userId, active.version],
    },
    writes: [
      {
        expectedChanges: 1,
        statement: db
          .prepare(
            `UPDATE user_message_foundations SET status='archived'
              WHERE id=? AND user_id=? AND status='active'
                AND ${fence.clause}`
          )
          .bind(active.id, userId, ...fence.values),
      },
      {
        expectedChanges: 1,
        statement: db
          .prepare(
            `INSERT INTO user_message_foundations
              (id,user_id,version,name,status,voice_rules_json,templates_json,
               created_at,activated_at)
             SELECT ?,?,?,?,'active',?,?,?,? WHERE ${fence.clause}`
          )
          .bind(
            id,
            userId,
            active.version + 1,
            active.name,
            JSON.stringify(rules),
            active.templates_json,
            timestamp,
            timestamp,
            ...fence.values
          ),
      },
    ],
  };
}
