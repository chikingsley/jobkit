import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "@/features/settings/view";
import { WorkspacePage } from "@/features/workspace/shell";

export const Route = createFileRoute("/app/settings/")({
  component: SettingsRoute,
});

function SettingsRoute() {
  return (
    <WorkspacePage>
      <SettingsView />
    </WorkspacePage>
  );
}
