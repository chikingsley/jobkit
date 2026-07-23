import type { CountrySweepTaskOutput } from "../../src/features/countries/schema";
import { AgentTaskError } from "./agent-tasks/contracts";
import type { CountryTaskLeaseContext } from "./agent-tasks/country-sweep-leases";
import { isConstraintError } from "./agent-tasks/run-store";
import {
  MAX_LEGACY_OUTPUT_BYTES,
  MAX_LEGACY_OUTPUT_RECORDS,
} from "./country-sweep-tasks/model";
import {
  normalizeOrganizations,
  prepareAuditTask,
  prepareDiscoveryTasks,
  prepareVerificationTasks,
  requiredChangesAssertionStatement,
} from "./country-sweep-tasks/normalization";
import {
  advanceCountrySweepStatement,
  completeCountryRunStatement,
  completeCountryTaskStatement,
  insertCoverageAuditStatement,
} from "./country-sweep-tasks/transitions";
import {
  completionGuardStatement,
  insertFollowUpTasksStatement,
  materializeCampaignTargetsStatement,
  readCompletionTask,
  upsertOrganizationContactsStatement,
  upsertOrganizationEvidenceStatement,
  upsertOrganizationsStatement,
} from "./country-sweep-tasks/writes";

export async function completeCountrySweepTask(
  db: D1Database,
  context: CountryTaskLeaseContext,
  output: CountrySweepTaskOutput
) {
  const task = await readCompletionTask(db, context);
  if (!task) {
    throw new AgentTaskError(
      "Country task lease changed before completion",
      409
    );
  }
  const outputJson = JSON.stringify(output);
  if (
    new TextEncoder().encode(outputJson).byteLength > MAX_LEGACY_OUTPUT_BYTES
  ) {
    throw new AgentTaskError(
      "Country task output requires chunked materialization",
      409
    );
  }
  const organizations = normalizeOrganizations(output.organizations);
  const contactCount = organizations.reduce(
    (count, organization) => count + organization.contactPoints.length,
    0
  );
  if (
    organizations.length > MAX_LEGACY_OUTPUT_RECORDS ||
    contactCount > MAX_LEGACY_OUTPUT_RECORDS
  ) {
    throw new AgentTaskError(
      "Country task output requires chunked materialization",
      409
    );
  }
  const organizationJson = JSON.stringify(organizations);
  const verificationTasks = await prepareVerificationTasks(task, organizations);
  const discoveryTasks =
    task.phase === "coverage_audit"
      ? await prepareDiscoveryTasks(task, output.coverageSummary.nextScopes)
      : [];
  const auditTask = await prepareAuditTask(task, context);
  const completionGuard = JSON.stringify({
    completionGuard: crypto.randomUUID(),
  });
  const statements: D1PreparedStatement[] = [
    completionGuardStatement(db, context, completionGuard),
    requiredChangesAssertionStatement(db, 1),
  ];
  if (organizations.length > 0) {
    statements.push(
      upsertOrganizationsStatement(
        db,
        context,
        organizationJson,
        completionGuard
      ),
      requiredChangesAssertionStatement(db, organizations.length),
      upsertOrganizationEvidenceStatement(
        db,
        context,
        task,
        organizationJson,
        completionGuard
      ),
      requiredChangesAssertionStatement(db, organizations.length)
    );
  }
  if (contactCount > 0) {
    statements.push(
      upsertOrganizationContactsStatement(
        db,
        context,
        organizationJson,
        completionGuard
      ),
      requiredChangesAssertionStatement(db, contactCount)
    );
  }
  if (organizations.length > 0) {
    statements.push(
      materializeCampaignTargetsStatement(
        db,
        context,
        organizationJson,
        completionGuard
      )
    );
  }
  if (verificationTasks.length > 0) {
    statements.push(
      insertFollowUpTasksStatement(
        db,
        context,
        "verification",
        verificationTasks,
        completionGuard
      )
    );
  }
  if (discoveryTasks.length > 0) {
    statements.push(
      insertFollowUpTasksStatement(
        db,
        context,
        "discovery",
        discoveryTasks,
        completionGuard
      )
    );
  }
  statements.push(
    completeCountryTaskStatement(db, context, outputJson, completionGuard),
    requiredChangesAssertionStatement(db, 1)
  );
  if (task.phase !== "coverage_audit") {
    statements.push(
      insertCoverageAuditStatement(db, context, auditTask, completionGuard)
    );
  }
  statements.push(
    advanceCountrySweepStatement(db, context, task, output, completionGuard),
    requiredChangesAssertionStatement(db, 1),
    completeCountryRunStatement(db, context, outputJson, completionGuard),
    requiredChangesAssertionStatement(db, 1)
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const completionError = new AgentTaskError(
        "Country task state changed before completion",
        409
      );
      completionError.cause = error;
      throw completionError;
    }
    throw error;
  }
  return {
    organizationCount: organizations.length,
    phase: task.phase,
    sweepId: context.sweepId,
    taskId: context.taskId,
  };
}
