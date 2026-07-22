import { createFileRoute } from "@tanstack/react-router";
import { AutomationView } from "@/features/automation/view";
import { WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/automation")({
  component: AutomationRoute,
});

function AutomationRoute() {
  return (
    <WorkspacePage>
      <AutomationView request={apiRequest} />
    </WorkspacePage>
  );
}
