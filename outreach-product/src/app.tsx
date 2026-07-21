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
import { filterJobs, selectVisibleJob } from "@/features/jobs/filters";
import { JobToolbar } from "@/features/jobs/job-toolbar";
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
const CampaignsWorkspace = lazy(async () => ({
  default: (await import("@/features/campaigns/workspace")).CampaignsWorkspace,
}));
const NewCampaignView = lazy(async () => ({
  default: (await import("@/features/campaigns/new-campaign")).NewCampaignView,
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
const TestLabView = lazy(async () => ({
  default: (await import("@/features/test-lab/view")).TestLabView,
}));
const SettingsView = lazy(async () => ({
  default: (await import("@/features/settings/view")).SettingsView,
}));
const OperatorView = lazy(async () => ({
  default: (await import("@/features/operator/view")).OperatorView,
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
    jobDetailError,
    jobDetailLoading,
    jobDetails,
    jobsError,
    loadJob,
  } = useWorkspaceData({ jobsEnabled: activeView === "jobs" });
  const setActiveView = useCallback(
    (view: WorkspaceView) => navigate(workspacePaths[view]),
    [navigate]
  );
  const nonAneslJobs = useMemo(
    () => jobs.filter((job) => job.board.toLowerCase() !== "anesl"),
    [jobs]
  );
  const visibleJobs = useMemo(
    () =>
      filterJobs(nonAneslJobs, matches, {
        country: countryFilter,
        fit: fitFilter,
        showExcluded,
      }),
    [countryFilter, fitFilter, matches, nonAneslJobs, showExcluded]
  );
  useEffect(() => {
    if (activeView !== "jobs") {
      return;
    }
    const selectedIsVisible = visibleJobs.some((job) => job.id === selectedId);
    const [firstJob] = visibleJobs;
    if (!selectedIsVisible && firstJob) {
      setSelectedId(firstJob.id);
    }
  }, [activeView, selectedId, setSelectedId, visibleJobs]);
  const selectedListItem = selectVisibleJob(visibleJobs, selectedId);
  const selectedDetail = selectedListItem
    ? jobDetails.get(selectedListItem.id)
    : undefined;
  const selected = selectedDetail?.job;
  const refreshJobs = useCallback(async () => {
    await loadJobs();
    if (selectedListItem) {
      await loadJob(selectedListItem.id);
    }
  }, [loadJob, loadJobs, selectedListItem]);

  useEffect(() => {
    if (
      activeView !== "jobs" ||
      !selectedListItem ||
      selectedDetail ||
      jobDetailLoading === selectedListItem.id
    ) {
      return;
    }
    void loadJob(selectedListItem.id).catch(() => undefined);
  }, [activeView, jobDetailLoading, loadJob, selectedDetail, selectedListItem]);

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
      await loadJob(selected.id);
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
      if (response.status === 202) {
        const queued = (await response.json()) as {
          notice: string;
          ok: true;
        };
        setInstruction("");
        await loadJobs({ quiet: true });
        await loadJob(selected.id);
        toast.success(queued.notice);
        return null;
      }
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
    <SidebarProvider
      className="h-svh min-h-0 overflow-hidden"
      defaultOpen={false}
    >
      <WorkspaceSidebar
        activeView={activeView}
        applied={jobs.filter((job) => job.status === "applied").length}
        email={currentUser.email}
        name={currentUser.name}
        onSignOut={() => authClient.signOut()}
        onViewChange={setActiveView}
        role={currentUser.role}
        totalJobs={activeView === "jobs" ? jobs.length : null}
      />
      <SidebarInset className="h-svh min-h-0 min-w-0 overflow-hidden">
        <WorkspaceHeader
          activeView={activeView}
          toolbar={
            activeView === "jobs" ? (
              <JobToolbar
                countries={countries}
                countryFilter={countryFilter}
                fitFilter={fitFilter}
                onCountryFilter={setCountryFilter}
                onFitFilter={setFitFilter}
                onRefresh={refreshJobs}
                onShowExcluded={setShowExcluded}
                onSort={setSort}
                refreshing={refreshing}
                showExcluded={showExcluded}
                sort={sort}
              />
            ) : undefined
          }
        />
        <Routes>
          <Route
            element={
              <WorkspacePage>
                {currentUser.role === "operator" ? (
                  <TestLabView request={apiRequest} />
                ) : (
                  <Navigate replace to={workspacePaths.jobs} />
                )}
              </WorkspacePage>
            }
            path={workspacePaths.testLab}
          />
          <Route
            element={
              <WorkspacePage>
                <SettingsView request={apiRequest} />
              </WorkspacePage>
            }
            path={workspacePaths.settings}
          />
          <Route
            element={
              <WorkspacePage>
                {currentUser.role === "operator" ? (
                  <OperatorView request={apiRequest} />
                ) : (
                  <Navigate replace to={workspacePaths.jobs} />
                )}
              </WorkspacePage>
            }
            path={workspacePaths.operator}
          />
          <Route
            element={
              <Suspense fallback={<ViewLoading />}>
                <CampaignsWorkspace request={apiRequest} />
              </Suspense>
            }
            path={workspacePaths.campaigns}
          />
          <Route
            element={
              <WorkspacePage>
                <NewCampaignView request={apiRequest} />
              </WorkspacePage>
            }
            path={`${workspacePaths.campaigns}/new`}
          />
          <Route
            element={
              <Suspense fallback={<ViewLoading />}>
                <CampaignsWorkspace request={apiRequest} />
              </Suspense>
            }
            path={`${workspacePaths.campaigns}/:campaignId`}
          />
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
                  fx={fx}
                  instruction={instruction}
                  jobDetailError={jobDetailError}
                  jobDetailLoading={
                    jobDetailLoading !== "" &&
                    jobDetailLoading === selectedListItem?.id
                  }
                  jobs={visibleJobs}
                  jobsError={jobsError}
                  jobsLoading={refreshing && jobs.length === 0}
                  matches={matches}
                  onAction={action}
                  onDraftAction={draftAction}
                  onInstruction={setInstruction}
                  onQualificationClaim={saveQualificationClaim}
                  onSelect={setSelectedId}
                  preferences={preferences}
                  profile={profile}
                  selected={selected}
                  selectedId={selectedListItem?.id}
                  selectedMatch={selectedDetail?.match}
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
