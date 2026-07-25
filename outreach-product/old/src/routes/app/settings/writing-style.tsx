import { createFileRoute } from "@tanstack/react-router";
import { MessageStyleView } from "@/features/message-style/view";
import { WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/writing-style")({
  component: WritingStyleRoute,
});

function WritingStyleRoute() {
  return (
    <WorkspacePage>
      <MessageStyleView request={apiRequest} />
    </WorkspacePage>
  );
}
