import {
  lazy,
  type PropsWithChildren,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useCurrentUser } from "@/features/auth/auth-gate";
import { monthlyCompensationUsd } from "@/features/jobs/compensation";
import { filterJobs, selectVisibleJob } from "@/features/jobs/filters";
import type { FxData, Job } from "@/features/jobs/types";
import { JobsWorkspace } from "@/features/jobs/workspace";
import {
  type WorkspaceView,
  workspacePaths,
  workspaceViewFromPathname,
} from "@/features/workspace/routes";
import {
  ViewLoading,
  WorkspaceHeader,
  WorkspaceSidebar,
} from "@/features/workspace/shell";
import { useWorkspaceStore } from "@/features/workspace/store";
import { apiRequest } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { evaluateJob } from "@/matching";
import type { Preferences, Profile, StoredDocument } from "@/profile-types";

const DocumentsView = lazy(async () => ({
  default: (await import("@/views/documents-view")).DocumentsView,
}));
const PreferencesView = lazy(async () => ({
  default: (await import("@/views/preferences-view")).PreferencesView,
}));
const ProfileView = lazy(async () => ({
  default: (await import("@/views/profile-view")).ProfileView,
}));

function WorkspacePage({ children }: PropsWithChildren) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <Suspense fallback={<ViewLoading />}>{children}</Suspense>
    </ScrollArea>
  );
}

export function App() {
  const currentUser = useCurrentUser();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeView = workspaceViewFromPathname(pathname);
  const countryFilter = useWorkspaceStore((state) => state.countryFilter);
  const setCountryFilter = useWorkspaceStore((state) => state.setCountryFilter);
  const fitFilter = useWorkspaceStore((state) => state.fitFilter);
  const setFitFilter = useWorkspaceStore((state) => state.setFitFilter);
  const selectedId = useWorkspaceStore((state) => state.selectedJobId);
  const setSelectedId = useWorkspaceStore((state) => state.setSelectedJobId);
  const showExcluded = useWorkspaceStore((state) => state.showExcluded);
  const setShowExcluded = useWorkspaceStore((state) => state.setShowExcluded);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [fx, setFx] = useState<FxData>({ rates: {}, updatedAt: null });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const setActiveView = useCallback(
    (view: WorkspaceView) => navigate(workspacePaths[view]),
    [navigate]
  );
  const loadJobs = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await apiRequest("/api/jobs");
      const data = (await response.json()) as { jobs: Job[] };
      setJobs(data.jobs);
      if (!useWorkspaceStore.getState().selectedJobId) {
        const [firstJob] = data.jobs;
        setSelectedId(firstJob ? firstJob.id : "");
      }
    } finally {
      setRefreshing(false);
    }
  }, [setSelectedId]);

  const loadDocuments = useCallback(async () => {
    const response = await apiRequest("/api/documents");
    const data = (await response.json()) as { documents: StoredDocument[] };
    setDocuments(data.documents);
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    void apiRequest("/api/fx")
      .then((response) => response.json())
      .then((data) => setFx(data as FxData))
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Exchange rates unavailable"
        )
      );
  }, []);

  useEffect(() => {
    void Promise.all([
      apiRequest("/api/profile").then(async (response) => {
        setProfile(((await response.json()) as { profile: Profile }).profile);
      }),
      apiRequest("/api/preferences").then(async (response) => {
        const value = ((await response.json()) as { preferences: Preferences })
          .preferences;
        setPreferences(value);
      }),
      loadDocuments(),
    ]).catch((error) =>
      toast.error(
        error instanceof Error ? error.message : "Workspace could not load"
      )
    );
  }, [loadDocuments]);

  const matches = useMemo(
    () =>
      new Map(
        profile && preferences
          ? jobs.map((job) => [
              job.id,
              evaluateJob(
                job.id,
                job.country,
                profile,
                preferences,
                monthlyCompensationUsd(job.compensation, fx)
              ),
            ])
          : []
      ),
    [fx, jobs, preferences, profile]
  );
  const countries = [...new Set(jobs.map((job) => job.country))].sort();
  const visibleJobs = filterJobs(jobs, matches, {
    country: countryFilter,
    fit: fitFilter,
    showExcluded,
  });
  const selected = selectVisibleJob(visibleJobs, selectedId);

  async function action(path: string, body?: object) {
    if (!selected) {
      return;
    }
    setBusy(path);
    try {
      const response = await apiRequest(path, {
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
      };
      setInstruction("");
      await loadJobs();
      toast.success(result.message ?? "Workspace updated");
    } catch (error) {
      await loadJobs().catch(() => undefined);
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <WorkspaceSidebar
        activeView={activeView}
        applied={jobs.filter((job) => job.status === "applied").length}
        email={currentUser.email}
        name={currentUser.name}
        onSignOut={() => authClient.signOut()}
        onViewChange={setActiveView}
        totalJobs={jobs.length}
      />
      <SidebarInset className="h-svh min-h-0 min-w-0 overflow-hidden">
        <WorkspaceHeader activeView={activeView} />
        <Routes>
          <Route
            element={
              <JobsWorkspace
                busy={busy}
                countries={countries}
                countryFilter={countryFilter}
                fitFilter={fitFilter}
                fx={fx}
                instruction={instruction}
                jobs={visibleJobs}
                matches={matches}
                onAction={action}
                onCountryFilter={setCountryFilter}
                onFitFilter={setFitFilter}
                onInstruction={setInstruction}
                onRefresh={loadJobs}
                onSelect={setSelectedId}
                onShowExcluded={setShowExcluded}
                preferences={preferences}
                profile={profile}
                refreshing={refreshing}
                selected={selected}
                showExcluded={showExcluded}
              />
            }
            path={workspacePaths.jobs}
          />
          <Route
            element={
              <WorkspacePage>
                {profile ? (
                  <ProfileView
                    onSaved={setProfile}
                    profile={profile}
                    request={apiRequest}
                  />
                ) : (
                  <ViewLoading />
                )}
              </WorkspacePage>
            }
            path={workspacePaths.profile}
          />
          <Route
            element={
              <WorkspacePage>
                {preferences ? (
                  <PreferencesView
                    onSaved={setPreferences}
                    preferences={preferences}
                    request={apiRequest}
                  />
                ) : (
                  <ViewLoading />
                )}
              </WorkspacePage>
            }
            path={workspacePaths.preferences}
          />
          <Route
            element={
              <WorkspacePage>
                <DocumentsView
                  documents={documents}
                  onChanged={loadDocuments}
                  request={apiRequest}
                />
              </WorkspacePage>
            }
            path={workspacePaths.documents}
          />
          <Route
            element={<Navigate replace to={workspacePaths.jobs} />}
            path="*"
          />
        </Routes>
      </SidebarInset>
    </SidebarProvider>
  );
}
