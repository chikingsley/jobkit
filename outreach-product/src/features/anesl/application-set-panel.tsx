import {
  CheckCircle2,
  FileText,
  MailCheck,
  RotateCcw,
  Send,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DraftEditor } from "@/features/jobs/draft-editor";
import type { DraftMutationResult } from "@/features/jobs/types";
import type { ApiRequest } from "@/lib/api";
import type { AneslApplicationSet, AneslApplicationSetResponse } from "./types";

export function ApplicationSetPanel({
  applicationSet,
  busy,
  onBusy,
  onChanged,
  request,
}: {
  applicationSet: AneslApplicationSet;
  busy: string;
  onBusy: (value: string) => void;
  onChanged: () => Promise<unknown>;
  request: ApiRequest;
}) {
  const [instruction, setInstruction] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const resourcePath = `/api/anesl/application-sets/${applicationSet.id}`;

  async function draftAction(
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ): Promise<DraftMutationResult | null> {
    onBusy(path);
    try {
      const response = await request(path, {
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: { "content-type": "application/json" },
        method: options.method ?? "POST",
      });
      const result = (await response.json()) as AneslApplicationSetResponse;
      await onChanged();
      setInstruction("");
      toast.success(result.notice ?? "ANESL draft updated");
      if (!result.applicationSet.draft) {
        return null;
      }
      return {
        draft: result.applicationSet.draft,
        notice: result.notice ?? "ANESL draft updated",
        ok: true,
      };
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Draft update failed"
      );
      return null;
    } finally {
      onBusy("");
    }
  }

  async function action(path: string, body?: object) {
    onBusy(path);
    try {
      const response = await request(path, {
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as { message?: string };
      await onChanged();
      toast.success(result.message ?? "ANESL application set updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      onBusy("");
    }
  }

  if (!applicationSet.draft) {
    return null;
  }
  const sent = applicationSet.status === "sent";
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-xl">ANESL application set</h2>
            <Badge variant={sent ? "default" : "secondary"}>
              {sent ? "Sent" : `${applicationSet.targets.length} selected`}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            One message and one thread to {applicationSet.recipient}
          </p>
        </div>
        {!sent && applicationSet.status !== "cancelled" ? (
          <Button
            disabled={Boolean(busy)}
            onClick={() => void action(`${resourcePath}/cancel`)}
            variant="ghost"
          >
            <RotateCcw /> Start over
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Selected positions</CardTitle>
          <CardDescription>
            These IDs travel together in the subject and message.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {applicationSet.targets.map((target) => (
            <div
              className="rounded-lg border bg-muted/20 p-3"
              key={target.jobId}
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline">{target.sourceReference}</Badge>
                <span className="truncate text-muted-foreground text-xs">
                  {target.location}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm">{target.title}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" /> Shared application message
          </CardTitle>
          <CardDescription>{applicationSet.subject}</CardDescription>
        </CardHeader>
        <CardContent>
          <DraftEditor
            busy={Boolean(busy) || sent}
            draft={applicationSet.draft}
            instruction={instruction}
            onDraftAction={draftAction}
            onInstruction={setInstruction}
            resourcePath={resourcePath}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery packet</CardTitle>
          <CardDescription>
            The five-document Visa market packet is frozen with this draft.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {applicationSet.draft.attachments.map((attachment) => (
            <Badge key={attachment.category} variant="outline">
              <CheckCircle2 /> {attachment.filename}
            </Badge>
          ))}
        </CardContent>
        {sent ? null : (
          <CardFooter className="flex-col items-stretch gap-3 border-t sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label
                className="font-medium text-xs"
                htmlFor="anesl-test-recipient"
              >
                Test recipient
              </label>
              <Input
                className="mt-1"
                id="anesl-test-recipient"
                onChange={(event) => setTestRecipient(event.target.value)}
                type="email"
                value={testRecipient}
              />
              {applicationSet.testSend ? (
                <p className="mt-1 text-muted-foreground text-xs">
                  {applicationSet.testSend.replyReceivedAt ? (
                    <>
                      <CheckCircle2 className="mr-1 inline size-3" /> Reply
                      received from {applicationSet.testSend.recipient}
                    </>
                  ) : (
                    <>
                      Last test: {applicationSet.testSend.status} to{" "}
                      {applicationSet.testSend.recipient}
                    </>
                  )}
                </p>
              ) : null}
            </div>
            <Button
              disabled={Boolean(busy) || !testRecipient.trim()}
              onClick={() =>
                void action(`${resourcePath}/test-send`, {
                  recipient: testRecipient.trim(),
                })
              }
              variant="outline"
            >
              <MailCheck /> Send test
            </Button>
            <Button
              disabled={Boolean(busy)}
              onClick={() =>
                void action(`${resourcePath}/send`, {
                  draftId: applicationSet.draft?.id,
                })
              }
            >
              <Send /> Send to ANESL
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
