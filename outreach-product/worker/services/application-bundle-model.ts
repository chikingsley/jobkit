import type { JobImport } from "../schemas";

export const ANESL_CONTACT_NAME = "Mr. Corey Yang";
export const ANESL_KIND = "anesl_positions";
export const ANESL_RECIPIENT = "hr@anesl.com";
export const ANESL_REQUIRED_QUESTION =
  "Would you be open to talking about which of these positions and locations you are currently recruiting for?";
const ANESL_BOARD = "anesl";
const ANESL_SOURCE_URL =
  "https://cafe.anesl.com/jobdetail.aspx?id=20150312125411629";
const MAX_ANESL_POSITIONS = 5;

export interface ApplicationBundleTargetRow extends Record<string, unknown> {
  application_bundle_id?: string;
  contact_channel_id: string;
  contact_name: string;
  contact_role: string;
  location: string;
  ordinal?: number;
  route_id: string;
  route_status: string;
  source_reference: string;
  title: string;
  user_job_id: string;
  user_job_status: string;
}

export class ApplicationBundleError extends Error {
  readonly status: 400 | 404 | 409 | 422;

  constructor(message: string, status: 400 | 404 | 409 | 422) {
    super(message);
    this.status = status;
  }
}

export async function readSelectedAneslTargets(
  db: D1Database,
  userId: string,
  jobIds: string[]
) {
  const placeholders = jobIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT j.*,uj.id user_job_id,uj.status user_job_status,uj.priority,
              (SELECT MAX(version) FROM application_drafts existing_draft
                WHERE existing_draft.user_job_id=uj.id) latest_draft_version,
              ar.id route_id,ar.status route_status,ar.contact_channel_id,
              COALESCE(c.role,'unknown') contact_role
         FROM user_listing_states uj
         JOIN job_listings j ON j.id=uj.job_id
         JOIN application_routes ar ON ar.id=(
           SELECT candidate.id FROM application_routes candidate
            WHERE candidate.job_id=j.id AND candidate.kind='email'
              AND candidate.status='active'
              AND lower(trim(candidate.destination))=?
            ORDER BY candidate.updated_at DESC LIMIT 1
         )
         LEFT JOIN contact_channels cc ON cc.id=ar.contact_channel_id
         LEFT JOIN contacts c ON c.id=cc.contact_id
        WHERE uj.user_id=? AND j.id IN (${placeholders})
          AND lower(j.board)=? AND uj.status IN ('new','review','failed')
          AND NOT EXISTS (
            SELECT 1 FROM application_bundle_targets existing_target
            JOIN application_bundles existing_bundle
              ON existing_bundle.id=existing_target.bundle_id
            WHERE existing_target.user_job_id=uj.id
              AND existing_bundle.status<>'cancelled'
          )`
    )
    .bind(ANESL_RECIPIENT, userId, ...jobIds, ANESL_BOARD)
    .all<ApplicationBundleTargetRow>();
  return rows.results;
}

export async function ensureSelectedAneslUserJobs(
  db: D1Database,
  userId: string,
  jobIds: string[]
) {
  const timestamp = new Date().toISOString();
  await db.batch(
    jobIds.map((jobId) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO user_listing_states
            (id,user_id,job_id,status,priority,created_at,updated_at)
           SELECT ?,?,j.id,'new',0,?,? FROM job_listings j
           WHERE j.id=? AND lower(j.board)=?`
        )
        .bind(
          crypto.randomUUID(),
          userId,
          timestamp,
          timestamp,
          jobId,
          ANESL_BOARD
        )
    )
  );
}

export async function readAneslBundleTargets(
  db: D1Database,
  userId: string,
  bundleId: string
) {
  const rows = await db
    .prepare(
      `SELECT j.*,uj.id user_job_id,uj.status user_job_status,uj.priority,
              bt.ordinal,bt.source_reference,bt.title,bt.location,
              ar.id route_id,ar.status route_status,ar.contact_channel_id,
              COALESCE(c.role,'unknown') contact_role
         FROM application_bundles b
         JOIN application_bundle_targets bt ON bt.bundle_id=b.id
         JOIN user_listing_states uj ON uj.id=bt.user_job_id
         JOIN job_listings j ON j.id=uj.job_id
         JOIN application_routes ar ON ar.id=bt.route_id
         LEFT JOIN contact_channels cc ON cc.id=ar.contact_channel_id
         LEFT JOIN contacts c ON c.id=cc.contact_id
        WHERE b.id=? AND b.user_id=?
        ORDER BY bt.ordinal`
    )
    .bind(bundleId, userId)
    .all<ApplicationBundleTargetRow>();
  return rows.results;
}

export function validateAneslSelection(jobIds: string[]) {
  const unique = new Set(jobIds);
  if (jobIds.length < 1 || jobIds.length > MAX_ANESL_POSITIONS) {
    throw new ApplicationBundleError(
      "Choose between one and five ANESL positions",
      400
    );
  }
  if (unique.size !== jobIds.length) {
    throw new ApplicationBundleError(
      "An ANESL position can appear only once in an application set",
      400
    );
  }
}

export function assertCompatibleAneslTargets(
  targets: ApplicationBundleTargetRow[]
) {
  if (targets.some((target) => !target.source_reference.trim())) {
    throw new ApplicationBundleError(
      "Every ANESL position needs a source reference before it can be sent",
      422
    );
  }
  const [first] = targets;
  if (
    !first ||
    targets.some(
      (target) =>
        target.route_status !== "active" ||
        target.contact_role !== "board_intermediary" ||
        target.contact_channel_id !== first.contact_channel_id
    )
  ) {
    throw new ApplicationBundleError(
      "Selected positions do not share the active ANESL intermediary route",
      409
    );
  }
}

export function aneslBundleJob(
  bundleId: string,
  targets: ApplicationBundleTargetRow[]
): JobImport {
  const references = targets.map((target) => target.source_reference);
  const marketSegments = Array.from(
    new Set(
      targets.flatMap(
        (target) =>
          JSON.parse(String(target.market_segments_json ?? "[]")) as string[]
      )
    )
  ) as JobImport["marketSegments"];
  return {
    applyEmail: ANESL_RECIPIENT,
    applyUrl: ANESL_SOURCE_URL,
    board: ANESL_BOARD,
    company: "ANESL",
    contactName: ANESL_CONTACT_NAME,
    country: "China",
    description: `Selected ANESL positions:\n${targets
      .map(
        (target) =>
          `${target.source_reference}: ${target.title}${target.location ? ` (${target.location})` : ""}`
      )
      .join("\n")}`,
    employerId: "anesl",
    id: `anesl-application-set:${bundleId}`,
    location: "Multiple locations in China",
    marketSegments,
    messageRoute: "multi_position",
    opportunityScope: "multi_position",
    priority: Math.max(
      ...targets.map((target) => Number(target.priority ?? 0))
    ),
    salary: "",
    sourceReference: references.join(", "),
    sourceUrl: ANESL_SOURCE_URL,
    title: `ANESL positions ${references.join(", ")}`,
  };
}

export function aneslBundleSubject(targets: ApplicationBundleTargetRow[]) {
  return `Native English Teacher Application - ${targets
    .map((target) => target.source_reference)
    .join(", ")}`.slice(0, 180);
}
