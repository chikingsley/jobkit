import { createFileRoute } from "@tanstack/react-router";
import { AutomationView } from "@/features/automation/view";
import { WorkspacePage } from "@/features/workspace/shell";

export const Route = createFileRoute("/app/settings/automation")({
  component: AutomationRoute,
});

function AutomationRoute() {
  return (
    <WorkspacePage>
      <AutomationView />
    </WorkspacePage>
  );
}
