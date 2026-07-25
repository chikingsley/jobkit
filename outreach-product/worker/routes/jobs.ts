import { filterJobs } from "../../src/features/jobs/filters";
import { parsePrivateJobListQuery } from "../../src/features/jobs/list-query";
import type { Job } from "../../src/features/jobs/types";
import { MATCHING_ENGINE_VERSION } from "../../src/pipeline/03_match/version";
import { queueJobDraftGeneration } from "../../src/pipeline/04_compose/application-drafts";
import {
  evaluateJobWithContext,
  readMatchingContext,
} from "../../src/pipeline/05_campaigns/matching-engine";
import type { JobKitApp } from "../app-types";
import {
  readAutomationPolicy,
  writeAutomationPolicy,
} from "../repositories/automation-policy";
import { fetchStaticJobMap, JobMapError } from "../services/job-map";
import { readJobListRows } from "./job-list-hydration";
import { readJobListPage } from "./job-list-read";
import {
  readReviewJob,
  summarizeMatch,
  toListEvaluationJob,
  toListJob,
  toReviewJob,
} from "./job-route-read-model";

export function registerJobRoutes(app: JobKitApp) {
  app.post("/api/jobs/:id/generate", async (c) => {
    const taskRequest = await queueJobDraftGeneration(
      c.env,
      c.get("user").id,
      c.req.param("id")
    );
    return c.json(
      {
        message: "Application queued for your Codex agent",
        ok: true,
        taskRequest,
      },
      202
    );
  });

  app.get("/api/jobs", async (c) => {
    const userId = c.get("user").id;
    const query = parsePrivateJobListQuery(new URL(c.req.url).searchParams);
    const context = await readMatchingContext(c.env, userId);
    const page = await readJobListPage(c.env.DB, {
      fx: context.fx,
      query,
      userId,
    });
    const rows = await readJobListRows(c.env.DB, userId, page.ids);
    const evaluated = rows.map((row) => {
      const job = toListEvaluationJob(row);
      const match = evaluateJobWithContext(job, context);
      return {
        job: toListJob(job, row, context.fx),
        match: summarizeMatch(match),
      };
    });
    const matches = new Map(
      evaluated.map(({ job, match }) => [job.id, match] as const)
    );
    const pageJobs = evaluated.map(({ job }) => job);
    const jobs = query.publicJob
      ? pageJobs
      : filterJobs(pageJobs, matches, {
          country: "all",
          fit: query.fit,
          showExcluded: query.showExcluded,
        });
    return c.json({
      countries: page.countries,
      fx: context.fx,
      jobs,
      matches: Object.fromEntries(
        jobs.map((job) => [job.id, matches.get(job.id)])
      ),
      matchingEngineVersion: MATCHING_ENGINE_VERSION,
      nextCursor: page.nextCursor,
      page: {
        appliedCount: page.appliedCount,
        hasMore: page.hasMore,
        limit: query.limit,
        offset: query.offset,
        totalAvailable: page.totalAvailable,
        totalCount: page.totalCount,
      },
    });
  });

  app.get("/api/jobs/:id", async (c) => {
    const userId = c.get("user").id;
    const row = await readReviewJob(c.env.DB, userId, c.req.param("id"));
    if (!row) {
      return c.json({ error: "Job was not found" }, 404);
    }
    const job = toReviewJob(row) as Job;
    const context = await readMatchingContext(c.env, userId);
    return c.json({
      job,
      match: evaluateJobWithContext(job, context),
      matchingEngineVersion: MATCHING_ENGINE_VERSION,
    });
  });

  app.get("/api/jobs/:id/map", async (c) => {
    const row = await readReviewJob(
      c.env.DB,
      c.get("user").id,
      c.req.param("id")
    );
    if (!row) {
      return c.json({ error: "Job was not found" }, 404);
    }
    const [location] = (toReviewJob(row) as Job).resolvedLocations;
    if (!location) {
      return c.json({ error: "A resolved map location is unavailable" }, 404);
    }
    try {
      return await fetchStaticJobMap(location, c.env.MAPBOX_ACCESS_TOKEN);
    } catch (error) {
      if (error instanceof JobMapError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  });

  app.get("/api/automation-policy", async (c) => {
    const result = await readAutomationPolicy(c.env.DB, c.get("user").id);
    return c.json({ policy: result.value, updatedAt: result.updatedAt });
  });

  app.put("/api/automation-policy", async (c) => {
    const result = await writeAutomationPolicy(
      c.env.DB,
      c.get("user").id,
      await c.req.json()
    );
    return c.json({
      message: "Automation policy saved",
      ok: true,
      policy: result.value,
      updatedAt: result.updatedAt,
    });
  });
}
