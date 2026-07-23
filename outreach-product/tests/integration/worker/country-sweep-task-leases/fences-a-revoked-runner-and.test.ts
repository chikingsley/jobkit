import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { materializeOneCountrySweepItem } from "../../../../worker/services/country-materialization/materializer";
import {
  authenticatedRequest,
  claimTask,
  createResearchRunner,
  createSweep,
  oneOrganizationOutput,
  readSourceTaskId,
  requireTask,
  runnerRequest,
  testEnv,
} from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("country sweep task leases", () => {
  it("fences a revoked runner and requeues its exact attempt", async () => {
    const { cookie } = await createSweep("country-revoked@example.test");
    const runner = await createResearchRunner(cookie, "Country revoked");
    const task = requireTask(await claimTask(runner.token));
    const sourceTaskId = await readSourceTaskId(task.runId);

    const revoked = await authenticatedRequest(
      `/api/agent-runners/${runner.id}`,
      cookie,
      "DELETE"
    );
    expect(revoked.status).toBe(200);
    expect(
      await testEnv.DB.prepare(
        `SELECT status,attempt_count,error_code,worker_id,lease_token
           FROM country_sweep_tasks WHERE id=?`
      )
        .bind(sourceTaskId)
        .first()
    ).toEqual({
      attempt_count: 1,
      error_code: "runner_revoked",
      lease_token: null,
      status: "queued",
      worker_id: null,
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT status,error_code FROM agent_task_runs WHERE id=?"
      )
        .bind(task.runId)
        .first()
    ).toEqual({ error_code: "runner_revoked", status: "failed" });
  });

  it("accepts immutable output before domain work and rolls back a guarded materialization", async () => {
    const { cookie, userId } = await createSweep(
      "country-rollback@example.test"
    );
    const runner = await createResearchRunner(cookie, "Country rollback");
    const task = requireTask(await claimTask(runner.token));
    const sweep = await testEnv.DB.prepare(
      "SELECT id FROM country_sweeps WHERE requested_by_user_id=?"
    )
      .bind(userId)
      .first<{ id: string }>();
    if (!sweep) {
      throw new Error("Country sweep was not created");
    }
    await testEnv.DB.prepare(
      `INSERT INTO organizations
        (id,country_code,country_name,name,identity_key,city,region,website_url,
         canonical_domain,market_segment,status,outreach_eligibility,
         evidence_url,source_sweep_id,created_at,updated_at)
       VALUES (
         'existing-school','TJ','Tajikistan','Existing School',
         'domain:existing-school.tj','Dushanbe','','https://existing-school.tj',
         'existing-school.tj','private_school','active','eligible',
         'https://existing-school.tj',?,
         '2026-07-22T00:00:00.000Z','2026-07-22T00:00:00.000Z'
       )`
    )
      .bind(sweep.id)
      .run();
    await testEnv.DB.prepare(
      `CREATE TRIGGER ignore_country_organization_update
       BEFORE UPDATE ON organizations
       WHEN OLD.id='existing-school'
       BEGIN
         SELECT RAISE(IGNORE);
       END`
    ).run();

    const response = await runnerRequest(
      `/api/agent-tasks/${task.runId}/complete`,
      runner.token,
      { leaseToken: task.leaseToken, output: oneOrganizationOutput() }
    );
    expect(response.status).toBe(200);
    const accepted = (await response.json()) as {
      result: { domainResult: { outputId: string } };
    };
    expect(
      await testEnv.DB.prepare(
        `SELECT task.status,task.output_json,run.status run_status,
                run.result_json
           FROM country_sweep_tasks task
           JOIN agent_task_runs run ON run.source_task_id=task.id
          WHERE run.id=?`
      )
        .bind(task.runId)
        .first()
    ).toEqual({
      output_json: expect.any(String),
      result_json: expect.any(String),
      run_status: "completed",
      status: "materializing",
    });
    await expect(
      materializeOneCountrySweepItem(
        testEnv,
        accepted.result.domainResult.outputId
      )
    ).rejects.toThrow("Country materialization lease changed");
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM organization_evidence evidence
          JOIN organizations organization ON organization.id=evidence.organization_id
         WHERE organization.id='existing-school'`
      ).first("count")
    ).resolves.toBe(0);
    expect(
      await testEnv.DB.prepare(
        `SELECT status,attempt_count FROM country_sweep_materialization_items
          WHERE output_id=? AND kind='organizations_chunk'`
      )
        .bind(accepted.result.domainResult.outputId)
        .first()
    ).toEqual({ attempt_count: 1, status: "queued" });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_output_organizations
          WHERE output_id=?`
      )
        .bind(accepted.result.domainResult.outputId)
        .first("count")
    ).resolves.toBe(0);
  });
});
