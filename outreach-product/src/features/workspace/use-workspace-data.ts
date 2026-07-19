import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { DraftMutationResult, FxData, Job } from "@/features/jobs/types";
import type {
  QualificationClaim,
  QualificationClaimAnswer,
  QualificationClaims,
} from "@/features/matching/claims";
import { apiRequest } from "@/lib/api";
import type {
  JobMatch,
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

export function useWorkspaceData() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [matches, setMatches] = useState<Map<string, JobMatch>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [fx, setFx] = useState<FxData>({ rates: {}, updatedAt: null });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [qualificationClaims, setQualificationClaims] =
    useState<QualificationClaims>({});
  const [busyClaimKey, setBusyClaimKey] = useState("");

  const loadJobs = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!options.quiet) {
      setRefreshing(true);
    }
    try {
      const response = await apiRequest("/api/jobs");
      const data = (await response.json()) as {
        fx: FxData;
        jobs: Job[];
        matches: Record<string, JobMatch>;
      };
      setJobs(data.jobs);
      setFx(data.fx);
      setMatches(new Map(Object.entries(data.matches)));
    } finally {
      if (!options.quiet) {
        setRefreshing(false);
      }
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    const response = await apiRequest("/api/documents");
    const data = (await response.json()) as { documents: StoredDocument[] };
    setDocuments(data.documents);
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
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
  }, [jobs, loadJobs]);

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
          ? {
              ...job,
              draft: {
                ...result.draft,
                attachments: job.draft?.attachments ?? [],
              },
              emailAttempt: null,
              status: "review",
            }
          : job
      )
    );
  }

  return {
    applyDraftMutation,
    busyClaimKey,
    countries: [...new Set(jobs.map((job) => job.country))].sort(),
    documents,
    fx,
    jobs,
    loadDocuments,
    loadJobs,
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
