import { useNavigate } from "@tanstack/react-router";
import { Globe2, Plus } from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CampaignDetailView } from "@/features/campaigns/detail";
import { CampaignStatusBadge } from "@/features/campaigns/detail-sections";
import type { CampaignSummary } from "@/features/campaigns/types";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type { ApiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

export function CampaignsWorkspace({
  campaignId = "",
  request,
}: {
  campaignId?: string;
  request: ApiRequest;
}) {
  const navigate = useNavigate();
  const {
    data: campaigns,
    isLoading,
    mutate: mutateCampaigns,
  } = useSWR("/api/campaigns", async (path) => {
    const payload = (await (await request(path)).json()) as {
      campaigns: CampaignSummary[];
    };
    return payload.campaigns;
  });

  const selectedId = campaignId || campaigns?.[0]?.id || "";

  return (
    <SplitWorkspace
      detail={
        selectedId ? (
          <CampaignDetailView
            campaignId={selectedId}
            onBack={() => void navigate({ to: "/app/campaigns" })}
            onChanged={() => mutateCampaigns()}
            request={request}
          />
        ) : (
          <EmptyCampaigns
            onCreate={() => void navigate({ to: "/app/campaigns/new" })}
          />
        )
      }
      detailOpen={Boolean(campaignId)}
      list={
        <>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-muted-foreground text-xs">
              {campaigns?.length
                ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`
                : "No campaigns"}
            </p>
            <div className="flex items-center gap-1">
              <Button
                aria-label="Markets"
                onClick={() => void navigate({ to: "/app/campaigns/markets" })}
                size="icon-sm"
                variant="ghost"
              >
                <Globe2 />
              </Button>
              <Button
                aria-label="New campaign"
                onClick={() => void navigate({ to: "/app/campaigns/new" })}
                size="icon-sm"
              >
                <Plus />
              </Button>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {campaigns?.map((campaign) => (
                <CampaignListItem
                  active={campaign.id === selectedId}
                  campaign={campaign}
                  key={campaign.id}
                  onSelect={() =>
                    void navigate({
                      params: { campaignId: campaign.id },
                      to: "/app/campaigns/$campaignId",
                    })
                  }
                />
              ))}
              {isLoading ? (
                <p className="px-3 py-8 text-center text-muted-foreground text-sm">
                  Loading campaigns…
                </p>
              ) : null}
              {campaigns && campaigns.length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <p className="text-muted-foreground text-sm">
                    No campaigns yet.
                  </p>
                  <Button
                    className="mt-3"
                    onClick={() => void navigate({ to: "/app/campaigns/new" })}
                    size="sm"
                  >
                    <Plus /> New campaign
                  </Button>
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </>
      }
    />
  );
}

function CampaignListItem({
  active,
  campaign,
  onSelect,
}: {
  active: boolean;
  campaign: CampaignSummary;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted",
        active && "bg-muted"
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{campaign.name}</div>
        </div>
        <CampaignStatusBadge status={campaign.status} />
      </div>
      <div className="mt-2 flex gap-3 text-muted-foreground text-xs">
        <span>{campaign.counts.sent.toLocaleString()} sent</span>
        <span>{campaign.counts.remaining.toLocaleString()} remaining</span>
        <span>{campaign.counts.humanReplies.toLocaleString()} replies</span>
      </div>
    </button>
  );
}

function EmptyCampaigns({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid min-h-[28rem] flex-1 place-items-center p-8 text-center">
      <div className="max-w-md">
        <h1 className="font-semibold text-2xl">
          Choose markets and let it run
        </h1>
        <p className="mt-2 text-muted-foreground text-sm leading-6">
          Build a campaign from every currently eligible posted opportunity and
          verified school contact, calibrate the first five messages, then watch
          delivery and replies in one place.
        </p>
        <Button className="mt-5" onClick={onCreate}>
          <Plus /> New campaign
        </Button>
      </div>
    </div>
  );
}
