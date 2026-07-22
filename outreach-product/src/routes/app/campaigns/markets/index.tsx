import { createFileRoute } from "@tanstack/react-router";
import { CountriesView } from "@/features/countries/view";
import { useWorkspaceContext } from "@/features/workspace/context";
import { ViewLoading, WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/campaigns/markets/")({
  component: MarketsRoute,
});

function MarketsRoute() {
  const { preferences } = useWorkspaceContext();
  return (
    <WorkspacePage>
      {preferences ? (
        <CountriesView preferences={preferences} request={apiRequest} />
      ) : (
        <ViewLoading />
      )}
    </WorkspacePage>
  );
}
