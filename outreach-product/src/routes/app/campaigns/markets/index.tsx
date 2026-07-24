import { createFileRoute } from "@tanstack/react-router";
import { CountriesView } from "@/features/countries/view";
import { usePreferences } from "@/features/preferences/queries";
import { ViewLoading, WorkspacePage } from "@/features/workspace/shell";

export const Route = createFileRoute("/app/campaigns/markets/")({
  component: MarketsRoute,
});

function MarketsRoute() {
  const preferencesQuery = usePreferences();
  return (
    <WorkspacePage>
      {preferencesQuery.data ? (
        <CountriesView preferences={preferencesQuery.data} />
      ) : (
        <ViewLoading />
      )}
    </WorkspacePage>
  );
}
