import { createFileRoute } from "@tanstack/react-router";
import { CampaignsWorkspace } from "@/features/campaigns/workspace";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/campaigns/$campaignId")({
  component: CampaignDetailRoute,
});

function CampaignDetailRoute() {
  const { campaignId } = Route.useParams();
  return <CampaignsWorkspace campaignId={campaignId} request={apiRequest} />;
}
