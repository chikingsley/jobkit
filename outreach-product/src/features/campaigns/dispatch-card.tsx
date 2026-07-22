import { LoaderCircle, MailCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  index,
  onApproveFailed,
  onApproveStart,
  onChanged,
  request,
}: {
  campaignId: string;
  dispatch: CampaignDispatch;
  index: number;
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
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Message {index + 1}</CardTitle>
            <p className="mt-1 text-muted-foreground text-sm">{targetLabels}</p>
          </div>
          <div className="flex gap-2">
            {dispatch.routeStrategy === "anesl_bundle" ? (
              <Badge variant="secondary">ANESL bundle</Badge>
            ) : null}
            {isRevising ? (
              <Badge variant="outline">
                <LoaderCircle className="animate-spin" /> Revising
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
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
              aria-label={`Revision instruction for message ${index + 1}`}
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
