import {
  lazy,
  type PropsWithChildren,
  Suspense,
  useCallback,
  useEffect,
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
import { filterJobs, selectVisibleJob } from "@/features/jobs/filters";
import type { DraftMutationResult } from "@/features/jobs/types";
import { useWorkspaceQueryState } from "@/features/workspace/query-state";
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
import { useWorkspaceData } from "@/features/workspace/use-workspace-data";
import { apiRequest } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const DocumentsView = lazy(async () => ({
  default: (await import("@/features/documents/view")).DocumentsView,
}));
const AutomationView = lazy(async () => ({
  default: (await import("@/features/automation/view")).AutomationView,
}));
const CountriesView = lazy(async () => ({
  default: (await import("@/features/countries/view")).CountriesView,
}));
const CountryView = lazy(async () => ({
  default: (await import("@/features/countries/country-view")).CountryView,
}));
const MessageStyleView = lazy(async () => ({
  default: (await import("@/features/message-style/view")).MessageStyleView,
}));
const PreferencesView = lazy(async () => ({
  default: (await import("@/features/preferences/view")).PreferencesView,
}));
const ProfileView = lazy(async () => ({
  default: (await import("@/features/profile/view")).ProfileView,
}));
const MessagesWorkspace = lazy(async () => ({
  default: (await import("@/features/messages/workspace")).MessagesWorkspace,
}));
const JobsWorkspace = lazy(async () => ({
  default: (await import("@/features/jobs/workspace")).JobsWorkspace,
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
  const {
    countryFilter,
    fitFilter,
    selectedJobId: selectedId,
    setCountryFilter,
    setFitFilter,
    setSelectedJobId: setSelectedId,
    setShowExcluded,
    setSort,
    showExcluded,
    sort,
  } = useWorkspaceQueryState();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const {
    applyDraftMutation,
    busyClaimKey,
    countries,
    documents,
    fx,
    jobs,
    loadDocuments,
    loadJobs,
    matches,
    preferences,
    profile,
    refreshing,
    saveQualificationClaim,
    setPreferences,
    setProfile,
  } = useWorkspaceData();
  const setActiveView = useCallback(
    (view: WorkspaceView) => navigate(workspacePaths[view]),
    [navigate]
  );
  useEffect(() => {
    const [firstJob] = jobs;
    if (!selectedId && firstJob) {
      setSelectedId(firstJob.id);
    }
  }, [jobs, selectedId, setSelectedId]);

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
      await loadJobs({ quiet: true });
      toast.success(result.message ?? "Workspace updated");
    } catch (error) {
      await loadJobs({ quiet: true }).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  async function draftAction(
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ): Promise<DraftMutationResult | null> {
    if (!selected) {
      return null;
    }
    setBusy(path);
    try {
      const response = await apiRequest(path, {
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: { "content-type": "application/json" },
        method: options.method ?? "POST",
      });
      const result = (await response.json()) as DraftMutationResult;
      applyDraftMutation(selected.id, result);
      setInstruction("");
      toast.success(result.notice);
      return result;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Draft update failed"
      );
      return null;
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
              <WorkspacePage>
                <AutomationView request={apiRequest} />
              </WorkspacePage>
            }
            path={workspacePaths.automation}
          />
          <Route
            element={
              <WorkspacePage>
                {preferences ? (
                  <CountriesView
                    preferences={preferences}
                    request={apiRequest}
                  />
                ) : (
                  <ViewLoading />
                )}
              </WorkspacePage>
            }
            path={workspacePaths.countries}
          />
          <Route
            element={
              <WorkspacePage>
                <CountryView request={apiRequest} />
              </WorkspacePage>
            }
            path={`${workspacePaths.countries}/:countryCode`}
          />
          <Route
            element={
              <Suspense fallback={<ViewLoading />}>
                <JobsWorkspace
                  busy={busy}
                  busyClaimKey={busyClaimKey}
                  countries={countries}
                  countryFilter={countryFilter}
                  fitFilter={fitFilter}
                  fx={fx}
                  instruction={instruction}
                  jobs={visibleJobs}
                  matches={matches}
                  onAction={action}
                  onCountryFilter={setCountryFilter}
                  onDraftAction={draftAction}
                  onFitFilter={setFitFilter}
                  onInstruction={setInstruction}
                  onQualificationClaim={saveQualificationClaim}
                  onRefresh={loadJobs}
                  onSelect={setSelectedId}
                  onShowExcluded={setShowExcluded}
                  onSort={setSort}
                  preferences={preferences}
                  profile={profile}
                  refreshing={refreshing}
                  selected={selected}
                  showExcluded={showExcluded}
                  sort={sort}
                />
              </Suspense>
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
            element={
              <WorkspacePage>
                <MessageStyleView request={apiRequest} />
              </WorkspacePage>
            }
            path={workspacePaths.messageStyle}
          />
          <Route
            element={
              <Suspense fallback={<ViewLoading />}>
                <MessagesWorkspace request={apiRequest} />
              </Suspense>
            }
            path={workspacePaths.messages}
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
