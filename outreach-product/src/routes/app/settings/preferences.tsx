import { createFileRoute } from "@tanstack/react-router";
import { PreferencesView } from "@/features/preferences/view";
import { useWorkspaceContext } from "@/features/workspace/context";
import { ViewLoading, WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/preferences")({
  component: PreferencesRoute,
});

function PreferencesRoute() {
  const { preferences, setPreferences } = useWorkspaceContext();
  return (
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
  );
}
