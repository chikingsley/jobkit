import { createFileRoute } from "@tanstack/react-router";
import {
  usePreferences,
  useSetPreferences,
} from "@/features/preferences/queries";
import { PreferencesView } from "@/features/preferences/view";
import { ViewLoading, WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/preferences")({
  component: PreferencesRoute,
});

function PreferencesRoute() {
  const preferencesQuery = usePreferences();
  const setPreferences = useSetPreferences();
  return (
    <WorkspacePage>
      {preferencesQuery.data ? (
        <PreferencesView
          onSaved={setPreferences}
          preferences={preferencesQuery.data}
          request={apiRequest}
        />
      ) : (
        <ViewLoading />
      )}
    </WorkspacePage>
  );
}
