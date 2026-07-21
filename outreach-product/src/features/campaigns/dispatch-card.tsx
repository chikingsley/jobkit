import { MailCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  onChanged,
  request,
}: {
  campaignId: string;
  dispatch: CampaignDispatch;
  index: number;
  onChanged: (campaign?: CampaignDetail) => Promise<void>;
  request: ApiRequest;
}) {
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<"campaign" | "future" | "message">(
    "message"
  );
  const [busy, setBusy] = useState("");

  async function revise() {
    setBusy("revise");
    try {
      const response = await request(
        `/api/campaigns/${campaignId}/dispatches/${dispatch.id}/revisions`,
        {
          body: JSON.stringify({
            dispatchId: dispatch.id,
            instruction,
            scope,
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
        error instanceof Error ? error.message : "Revision could not be queued"
      );
    } finally {
      setBusy("");
    }
  }

  async function approve() {
    setBusy("approve");
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
      toast.error(
        error instanceof Error ? error.message : "Message could not be approved"
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Message {index + 1}</CardTitle>
            <p className="mt-1 text-muted-foreground text-sm">
              {dispatch.targets.map((target) => target.label).join(" · ")}
            </p>
          </div>
          <div className="flex gap-2">
            {dispatch.routeStrategy === "anesl_bundle" ? (
              <Badge variant="secondary">ANESL bundle</Badge>
            ) : null}
            <Badge variant="outline">
              {dispatch.status.replaceAll("_", " ")}
            </Badge>
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
            />
            {dispatch.message.changeSummary ? (
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                <div className="font-medium">What changed</div>
                <p className="mt-1 text-muted-foreground">
                  {dispatch.message.changeSummary}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            Waiting for the paired Codex runner to prepare this message.
          </div>
        )}
        {dispatch.message && dispatch.status === "review" ? (
          <div className="grid gap-3 rounded-lg border p-3">
            <Textarea
              aria-label={`Revision instruction for message ${index + 1}`}
              className="min-h-20"
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Describe one change. The revised message will replace this one in place."
              value={instruction}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select
                onValueChange={(value) =>
                  setScope(value as "campaign" | "future" | "message")
                }
                value={scope}
              >
                <SelectTrigger aria-label="Revision scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="message">This message</SelectItem>
                    <SelectItem value="campaign">Remaining campaign</SelectItem>
                    <SelectItem value="future">Future campaigns</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button
                  disabled={Boolean(busy) || !instruction.trim()}
                  onClick={() => void revise()}
                  variant="secondary"
                >
                  {busy === "revise" ? "Revising…" : "Revise"}
                </Button>
                <Button disabled={Boolean(busy)} onClick={() => void approve()}>
                  <MailCheck />
                  {busy === "approve" ? "Approving…" : "Approve"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
