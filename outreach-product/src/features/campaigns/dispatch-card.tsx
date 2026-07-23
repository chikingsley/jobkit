import { LoaderCircle, MailCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  CampaignDetail,
  CampaignDispatch,
} from "@/features/campaigns/types";
import { MessageChanges, MessageText } from "@/features/jobs/message-diff";
import type { ApiRequest } from "@/lib/api";

export function CampaignDispatchCard({
  campaignId,
  dispatch,
  onApproveFailed,
  onApproveStart,
  onChanged,
  request,
}: {
  campaignId: string;
  dispatch: CampaignDispatch;
  onApproveFailed: () => void;
  onApproveStart: () => void;
  onChanged: (campaign?: CampaignDetail) => Promise<void>;
  request: ApiRequest;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const isRevising = busy === "revise" || dispatch.status === "drafting";
  const targetLabels = dispatch.targets
    .map((target) => target.label)
    .join(" · ");
  const context = dispatchContext(dispatch);

  async function revise() {
    setBusy("revise");
    try {
      const response = await request(
        `/api/campaigns/${campaignId}/dispatches/${dispatch.id}/revisions`,
        {
          body: JSON.stringify({
            dispatchId: dispatch.id,
            instruction,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
      const payload = (await response.json()) as { message: string };
      setInstruction("");
      await onChanged();
      toast.success(payload.message);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Revision failed. Try the change again."
      );
    } finally {
      setBusy("");
    }
  }

  async function approve() {
    setBusy("approve");
    onApproveStart();
    try {
      const response = await request(
        `/api/campaigns/${campaignId}/dispatches/${dispatch.id}/approve`,
        { method: "POST" }
      );
      const payload = (await response.json()) as {
        campaign: CampaignDetail;
        message: string;
      };
      await onChanged(payload.campaign);
      toast.success(payload.message);
    } catch (error) {
      onApproveFailed();
      toast.error(
        error instanceof Error
          ? error.message
          : "Approval failed. The message is back in the queue."
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <Card
      data-campaign-dispatch-id={dispatch.id}
      data-testid={`campaign-dispatch-${dispatch.id}`}
      tabIndex={-1}
    >
      <CardContent className="grid gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium leading-5">{context.title}</p>
            <p className="mt-1 text-muted-foreground text-xs">{context.meta}</p>
          </div>
          <div className="flex gap-2">
            {isRevising ? (
              <Badge variant="outline">
                <LoaderCircle className="animate-spin" /> Revising
              </Badge>
            ) : null}
          </div>
        </div>
        {dispatch.routeStrategy === "anesl_bundle" &&
        dispatch.targets.length > 1 ? (
          <details className="group border-y py-2 text-sm">
            <summary className="cursor-pointer list-none font-medium marker:content-none">
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="transition-transform group-open:rotate-90"
                >
                  ▶
                </span>
                Selected positions ({dispatch.targets.length})
              </span>
            </summary>
            <ul className="mt-2 grid gap-1 pl-5 text-muted-foreground">
              {dispatch.targets.map((target) => (
                <li className="list-disc" key={target.id}>
                  {target.label}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {dispatch.message ? (
          <>
            <MessageText
              highlightChanges={Boolean(dispatch.message.previousMessage)}
              message={dispatch.message.message}
              previousMessage={dispatch.message.previousMessage}
            />
            <MessageChanges
              message={dispatch.message.message}
              previousMessage={dispatch.message.previousMessage}
              version={dispatch.message.version}
            />
            {dispatch.message.changeSummary ? (
              <p className="text-muted-foreground text-sm">
                <span className="font-medium text-foreground">
                  v{dispatch.message.version}
                </span>{" "}
                · {dispatch.message.changeSummary}
              </p>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            Waiting for the paired Codex runner to prepare this message.
          </div>
        )}
        {dispatch.message &&
        ["drafting", "review"].includes(dispatch.status) ? (
          <div className="grid gap-3 border-t pt-4">
            <label
              className="font-medium text-sm"
              htmlFor={`campaign-revision-${dispatch.id}`}
            >
              Describe the change
            </label>
            <Textarea
              aria-label={`Revision instruction for ${context.title}`}
              className="min-h-28 w-full resize-y px-3 py-3 leading-6"
              disabled={isRevising}
              id={`campaign-revision-${dispatch.id}`}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="For example: Remove the engineering paragraph."
              value={instruction}
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <Button
                aria-label={`Revise message for ${targetLabels}`}
                disabled={Boolean(busy) || isRevising || !instruction.trim()}
                onClick={() => void revise()}
                variant="secondary"
              >
                {isRevising ? "Revising…" : "Revise"}
              </Button>
              <Button
                aria-label={`Approve message for ${targetLabels}`}
                disabled={Boolean(busy) || isRevising}
                onClick={() => void approve()}
              >
                <MailCheck />
                {busy === "approve" ? "Approving…" : "Approve"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function dispatchContext(dispatch: CampaignDispatch) {
  const countries = [
    ...new Set(
      dispatch.targets
        .map((target) => countryName(target.countryCode))
        .filter(Boolean)
    ),
  ];
  const market =
    countries.length > 1
      ? `${countries.length} markets`
      : (countries[0] ?? "Market unavailable");
  const channel = channelLabel(dispatch.channel);

  if (dispatch.routeStrategy === "anesl_bundle") {
    return {
      meta: `${dispatch.targets.length} selected position${
        dispatch.targets.length === 1 ? "" : "s"
      } · ${channel} · ${market}`,
      title: "ANESL application bundle",
    };
  }

  const primaryTarget = dispatch.targets.at(0);
  return {
    meta: `${
      primaryTarget?.sourceKind === "school" ? "Cold outreach" : "Posted job"
    } · ${channel} · ${market}`,
    title: primaryTarget?.label ?? "Campaign message",
  };
}

function channelLabel(channel: CampaignDispatch["channel"]) {
  if (channel === "board_form") {
    return "Application form";
  }
  if (channel === "external_url") {
    return "External application";
  }
  if (channel === "manual") {
    return "Manual application";
  }
  return "Email";
}

function countryName(countryCode: string) {
  return (
    new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ??
    countryCode
  );
}
