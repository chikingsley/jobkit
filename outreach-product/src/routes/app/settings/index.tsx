import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "@/features/settings/view";
import { WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/")({
  component: SettingsRoute,
});

function SettingsRoute() {
  return (
    <WorkspacePage>
      <SettingsView request={apiRequest} />
    </WorkspacePage>
  );
}
