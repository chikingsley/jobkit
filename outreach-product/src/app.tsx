import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Suspense, useCallback } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useCurrentUser } from "@/features/auth/auth-gate";
import { JobsRouteToolbar } from "@/features/jobs/route";
import { WorkspaceDataContext } from "@/features/workspace/context";
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
import { authClient } from "@/lib/auth-client";

export function App() {
  const currentUser = useCurrentUser();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const activeView = workspaceViewFromPathname(pathname);
  const workspace = useWorkspaceData({ jobsEnabled: activeView === "jobs" });
  const setActiveView = useCallback(
    (view: WorkspaceView) => {
      void navigate({ to: workspacePaths[view] });
    },
    [navigate]
  );

  return (
    <WorkspaceDataContext.Provider value={workspace}>
      <SidebarProvider
        className="h-svh min-h-0 overflow-hidden"
        defaultOpen={false}
      >
        <WorkspaceSidebar
          activeView={activeView}
          applied={workspace.jobPage.appliedCount}
          email={currentUser.email}
          name={currentUser.name}
          onSignOut={() => authClient.signOut()}
          onViewChange={setActiveView}
          role={currentUser.role}
          totalJobs={
            activeView === "jobs" ? workspace.jobPage.totalAvailable : null
          }
        />
        <SidebarInset className="h-svh min-h-0 min-w-0 overflow-hidden">
          <WorkspaceHeader
            activeView={activeView}
            toolbar={activeView === "jobs" ? <JobsRouteToolbar /> : undefined}
          />
          <Suspense fallback={<ViewLoading />}>
            <Outlet />
          </Suspense>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceDataContext.Provider>
  );
}
