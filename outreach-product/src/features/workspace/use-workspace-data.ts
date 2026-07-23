import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  PRIVATE_JOB_PAGE_SIZE,
  type PrivateJobListQuery,
  privateJobListSearchParams,
} from "@/features/jobs/list-query";
import type {
  DraftMutationResult,
  FxData,
  Job,
  JobListItem,
} from "@/features/jobs/types";
import type {
  QualificationClaim,
  QualificationClaimAnswer,
  QualificationClaims,
} from "@/features/matching/claims";
import { apiRequest } from "@/lib/api";
import type {
  JobMatch,
  JobMatchSummary,
  Preferences,
  Profile,
  StoredDocument,
} from "@/profile-types";

interface QualificationClaimInput {
  answer: QualificationClaimAnswer | null;
  claimKey: string;
  kind: string;
  label: string;
}

const AGENT_TASK_REFRESH_MS = 1500;
const defaultJobQuery: PrivateJobListQuery = {
  country: "all",
  excludeBoard: "anesl",
  fit: "all",
  limit: PRIVATE_JOB_PAGE_SIZE,
  offset: 0,
  showExcluded: false,
  sort: "stated-hourly",
};

interface JobPage {
  appliedCount: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  totalAvailable: number;
  totalCount: number;
}

const emptyJobPage: JobPage = {
  appliedCount: 0,
  hasMore: false,
  limit: PRIVATE_JOB_PAGE_SIZE,
  offset: 0,
  totalAvailable: 0,
  totalCount: 0,
};

export function useWorkspaceData({ jobsEnabled }: { jobsEnabled: boolean }) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [jobPage, setJobPage] = useState<JobPage>(emptyJobPage);
  const [matches, setMatches] = useState<Map<string, JobMatchSummary>>(
    new Map()
  );
  const [jobDetails, setJobDetails] = useState(
    new Map<string, { job: Job; match: JobMatch }>()
  );
  const [jobsError, setJobsError] = useState("");
  const [jobDetailError, setJobDetailError] = useState("");
  const [jobDetailLoading, setJobDetailLoading] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [fx, setFx] = useState<FxData>({ rates: {}, updatedAt: null });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [qualificationClaims, setQualificationClaims] =
    useState<QualificationClaims>({});
  const [busyClaimKey, setBusyClaimKey] = useState("");
  const currentJobQuery = useRef(defaultJobQuery);

  const loadJobs = useCallback(
    async (
      options: {
        append?: boolean;
        query?: PrivateJobListQuery;
        quiet?: boolean;
      } = {}
    ) => {
      const query = options.query ?? currentJobQuery.current;
      if (query.offset === 0) {
        currentJobQuery.current = query;
      }
      if (!options.quiet) {
        setRefreshing(true);
      }
      try {
        setJobsError("");
        const search = privateJobListSearchParams(query);
        const response = await apiRequest(`/api/jobs?${search}`);
        const data = (await response.json()) as {
          countries: string[];
          fx: FxData;
          jobs: JobListItem[];
          matches: Record<string, JobMatchSummary>;
          page: JobPage;
        };
        setJobs((current) =>
          options.append ? appendUniqueJobs(current, data.jobs) : data.jobs
        );
        setCountries(data.countries);
        setFx(data.fx);
        setJobPage(data.page);
        setMatches((current) =>
          options.append
            ? new Map([...current, ...Object.entries(data.matches)])
            : new Map(Object.entries(data.matches))
        );
      } catch (error) {
        setJobsError(
          error instanceof Error ? error.message : "Jobs could not load"
        );
        throw error;
      } finally {
        if (!options.quiet) {
          setRefreshing(false);
        }
      }
    },
    []
  );

  const loadMoreJobs = useCallback(async () => {
    if (!jobPage.hasMore) {
      return;
    }
    await loadJobs({
      append: true,
      query: {
        ...currentJobQuery.current,
        offset: jobs.length,
      },
    });
  }, [jobPage.hasMore, jobs.length, loadJobs]);

  const loadJob = useCallback(async (jobId: string) => {
    setJobDetailError("");
    setJobDetailLoading(jobId);
    try {
      const response = await apiRequest(`/api/jobs/${jobId}`);
      const data = (await response.json()) as { job: Job; match: JobMatch };
      setJobDetails((current) => {
        const next = new Map(current);
        next.set(jobId, data);
        return next;
      });
      return data;
    } catch (error) {
      setJobDetailError(
        error instanceof Error ? error.message : "Job details could not load"
      );
      throw error;
    } finally {
      setJobDetailLoading((current) => (current === jobId ? "" : current));
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    const response = await apiRequest("/api/documents");
    const data = (await response.json()) as { documents: StoredDocument[] };
    setDocuments(data.documents);
  }, []);

  useEffect(() => {
    if (!jobsEnabled) {
      return;
    }
    const hasActiveDraftTask = jobs.some(
      (job) =>
        job.draftTask?.status === "queued" ||
        job.draftTask?.status === "claimed"
    );
    if (!hasActiveDraftTask) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadJobs({ quiet: true });
    }, AGENT_TASK_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [jobs, jobsEnabled, loadJobs]);

  useEffect(() => {
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    if (!timeZone) {
      return;
    }
    void apiRequest("/api/time-zone", {
      body: JSON.stringify({ timeZone }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }).catch((error) =>
      toast.error(
        error instanceof Error ? error.message : "Time zone could not be saved"
      )
    );
  }, []);

  useEffect(() => {
    void Promise.all([
      apiRequest("/api/profile").then(async (response) => {
        setProfile(((await response.json()) as { profile: Profile }).profile);
      }),
      apiRequest("/api/preferences").then(async (response) => {
        setPreferences(
          ((await response.json()) as { preferences: Preferences }).preferences
        );
      }),
      loadDocuments(),
      apiRequest("/api/qualification-claims").then(async (response) => {
        setQualificationClaims(
          ((await response.json()) as { claims: QualificationClaims }).claims
        );
      }),
    ]).catch((error) =>
      toast.error(
        error instanceof Error ? error.message : "Workspace could not load"
      )
    );
  }, [loadDocuments]);

  async function saveQualificationClaim(input: QualificationClaimInput) {
    setBusyClaimKey(input.claimKey);
    try {
      const response = await apiRequest("/api/qualification-claims", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      const { claim } = (await response.json()) as {
        claim: QualificationClaim | null;
      };
      setQualificationClaims((current) => {
        const next = { ...current };
        if (claim) {
          next[claim.claimKey] = claim;
        } else {
          delete next[input.claimKey];
        }
        return next;
      });
      await loadJobs({ quiet: true });
      setJobDetails(new Map());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Qualification answer failed"
      );
    } finally {
      setBusyClaimKey("");
    }
  }

  function applyDraftMutation(jobId: string, result: DraftMutationResult) {
    setJobs((current) =>
      current.map((job) =>
        job.id === jobId
          ? { ...job, emailAttempt: null, status: "review" }
          : job
      )
    );
    setJobDetails((current) => {
      const existing = current.get(jobId);
      if (!existing) {
        return current;
      }
      const next = new Map(current);
      next.set(jobId, {
        ...existing,
        job: {
          ...existing.job,
          draft: {
            ...result.draft,
            attachments: existing.job.draft?.attachments ?? [],
          },
          emailAttempt: null,
          status: "review",
        },
      });
      return next;
    });
  }

  return {
    applyDraftMutation,
    busyClaimKey,
    countries,
    documents,
    fx,
    jobDetailError,
    jobDetailLoading,
    jobDetails,
    jobPage,
    jobs,
    jobsError,
    loadDocuments,
    loadJob,
    loadJobs,
    loadMoreJobs,
    matches,
    preferences,
    profile,
    qualificationClaims,
    refreshing,
    saveQualificationClaim,
    setPreferences,
    setProfile,
  };
}

function appendUniqueJobs(current: JobListItem[], incoming: JobListItem[]) {
  const jobs = new Map(current.map((job) => [job.id, job]));
  for (const job of incoming) {
    jobs.set(job.id, job);
  }
  return [...jobs.values()];
}
