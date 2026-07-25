import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Suspense, useCallback } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useCurrentUser } from "@/features/auth/auth-gate";
import { useJobListMeta } from "@/features/jobs/queries";
import { JobsRouteToolbar } from "@/features/jobs/route";
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
import { useTimeZoneSync } from "@/features/workspace/use-time-zone-sync";
import { authClient } from "@/lib/auth-client";

export function App() {
  const currentUser = useCurrentUser();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const activeView = workspaceViewFromPathname(pathname);
  useTimeZoneSync();
  const jobsMeta = useJobListMeta(activeView === "jobs");
  const setActiveView = useCallback(
    (view: WorkspaceView) => {
      void navigate({ to: workspacePaths[view] });
    },
    [navigate]
  );

  return (
    <SidebarProvider
      className="h-svh min-h-0 overflow-hidden"
      defaultOpen={false}
    >
      <WorkspaceSidebar
        activeView={activeView}
        applied={jobsMeta.page.appliedCount}
        email={currentUser.email}
        name={currentUser.name}
        onSignOut={() => authClient.signOut()}
        onViewChange={setActiveView}
        role={currentUser.role}
        totalJobs={activeView === "jobs" ? jobsMeta.page.totalAvailable : null}
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
  );
}
