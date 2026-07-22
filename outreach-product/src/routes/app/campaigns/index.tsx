import { createFileRoute } from "@tanstack/react-router";
import { CampaignsWorkspace } from "@/features/campaigns/workspace";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/campaigns/")({
  component: CampaignsRoute,
});

function CampaignsRoute() {
  return <CampaignsWorkspace request={apiRequest} />;
}
