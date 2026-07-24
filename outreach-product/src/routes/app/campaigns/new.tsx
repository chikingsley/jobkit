import { createFileRoute } from "@tanstack/react-router";
import { NewCampaignView } from "@/features/campaigns/new-campaign";
import { newCampaignSearchSchema } from "@/features/workspace/search";
import { WorkspacePage } from "@/features/workspace/shell";

export const Route = createFileRoute("/app/campaigns/new")({
  component: NewCampaignRoute,
  validateSearch: newCampaignSearchSchema,
});

function NewCampaignRoute() {
  return (
    <WorkspacePage>
      <NewCampaignView />
    </WorkspacePage>
  );
}
