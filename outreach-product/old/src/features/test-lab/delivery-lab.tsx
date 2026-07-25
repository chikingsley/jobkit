import { Download, FileCheck2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDocuments } from "@/features/documents/queries";
import {
  useCaptureDeliveryMime,
  useDeliveryAllowlistMutation,
  useDeliveryLab,
  useSimulateDeliveryEvent,
} from "@/features/test-lab/queries";

const DEFAULT_TEST_MESSAGE = `Hello,

This is a JobKit Test Lab delivery capture. It must be stored as MIME and must not be sent externally.

Best,
JobKit Test`;

export function DeliveryLab() {
  const { data } = useDeliveryLab();
  const { data: documents } = useDocuments();
  const allowlistMutation = useDeliveryAllowlistMutation();
  const captureMutation = useCaptureDeliveryMime();
  const simulateMutation = useSimulateDeliveryEvent();
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("JobKit Test Lab MIME capture");
  const [message, setMessage] = useState(DEFAULT_TEST_MESSAGE);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const busy = captureMutation.isPending;

  useEffect(() => {
    if (!recipient && data?.allowlist[0]?.email) {
      setRecipient(data.allowlist[0].email);
    }
  }, [data?.allowlist, recipient]);

  async function allowlist(email: string) {
    try {
      await allowlistMutation.mutateAsync({ action: "add", email });
      setRecipient(email);
      toast.success("Test address allowlisted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Allowlist update failed"
      );
    }
  }

  async function removeAllowlist(email: string) {
    try {
      await allowlistMutation.mutateAsync({ action: "remove", email });
      if (recipient === email) {
        setRecipient("");
      }
      toast.success("Test address removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Allowlist update failed"
      );
    }
  }

  async function capture() {
    try {
      const result = await captureMutation.mutateAsync({
        attachmentDocumentIds: attachmentIds,
        message,
        recipient,
        subject,
      });
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "MIME capture failed"
      );
    }
  }

  async function simulate(
    captureId: string,
    eventType: "automated_reply" | "bounce" | "human_reply"
  ) {
    try {
      await simulateMutation.mutateAsync({ captureId, eventType });
      toast.success("Provider event simulated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Simulation failed");
    }
  }

  const allowlisted = new Set(
    (data?.allowlist ?? []).map((address) =>
      address.email.toLocaleLowerCase("en")
    )
  );
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Explicit test allowlist</CardTitle>
          <CardDescription>
            Only the signed-in address or active OAuth Gmail mailbox can be
            added. Capturing MIME never invokes Gmail or another delivery
            provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(data?.eligibleAddresses ?? []).map((address) => {
            const active = allowlisted.has(
              address.email.toLocaleLowerCase("en")
            );
            return (
              <div
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                key={address.email}
              >
                <ShieldCheck className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-all text-sm">
                  {address.email}
                </span>
                <Badge variant="outline">{address.ownershipBasis}</Badge>
                {active ? (
                  <Button
                    onClick={() => void removeAllowlist(address.email)}
                    size="sm"
                    variant="outline"
                  >
                    <Trash2 /> Remove
                  </Button>
                ) : (
                  <Button
                    onClick={() => void allowlist(address.email)}
                    size="sm"
                    variant="outline"
                  >
                    <Plus /> Allow for tests
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compose exact MIME</CardTitle>
          <CardDescription>
            This uses the same MIME composer as production, stores the exact
            bytes in the private document bucket, and records a SHA-256 hash.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="test-delivery-recipient"
          >
            <span className="font-medium">Allowlisted recipient</span>
            <Input
              id="test-delivery-recipient"
              list="test-delivery-addresses"
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="Allowlist an owned inbox first"
              value={recipient}
            />
            <datalist id="test-delivery-addresses">
              {(data?.allowlist ?? []).map((address) => (
                <option key={address.email} value={address.email} />
              ))}
            </datalist>
          </label>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="test-delivery-subject"
          >
            <span className="font-medium">Subject</span>
            <Input
              id="test-delivery-subject"
              onChange={(event) => setSubject(event.target.value)}
              value={subject}
            />
          </label>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="test-delivery-message"
          >
            <span className="font-medium">Message</span>
            <Textarea
              className="min-h-52 font-mono text-sm leading-6"
              id="test-delivery-message"
              onChange={(event) => setMessage(event.target.value)}
              value={message}
            />
            <span className="text-muted-foreground text-xs">
              Newlines are preserved exactly in the captured text/plain body.
            </span>
          </label>
          {(documents ?? []).length > 0 ? (
            <div className="grid gap-2">
              <div className="font-medium text-sm">Attachments</div>
              <div className="grid gap-2 md:grid-cols-2">
                {documents?.map((document) => (
                  <label
                    className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                    htmlFor={`delivery-document-${document.id}`}
                    key={document.id}
                  >
                    <Checkbox
                      checked={attachmentIds.includes(document.id)}
                      id={`delivery-document-${document.id}`}
                      onCheckedChange={(checked) =>
                        setAttachmentIds((current) =>
                          checked
                            ? [...current, document.id]
                            : current.filter((id) => id !== document.id)
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {document.filename}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatBytes(document.size_bytes)} ·{" "}
                        {document.content_type}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            disabled={!(recipient && subject.trim() && message.trim()) || busy}
            onClick={() => void capture()}
          >
            <FileCheck2 /> {busy ? "Capturing…" : "Capture without sending"}
          </Button>
        </CardFooter>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {(data?.captures ?? []).map((captureItem) => (
          <Card key={captureItem.id}>
            <CardHeader>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">not sent</Badge>
                <Badge variant="outline">
                  {formatBytes(captureItem.sizeBytes)}
                </Badge>
              </div>
              <CardTitle className="text-base">{captureItem.subject}</CardTitle>
              <CardDescription>{captureItem.recipient}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="break-all rounded bg-muted p-2 font-mono text-xs">
                SHA-256 {captureItem.mimeSha256}
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border p-3 font-mono text-xs leading-5">
                {captureItem.message}
              </pre>
              {captureItem.attachments.length > 0 ? (
                <div className="text-muted-foreground text-xs">
                  {captureItem.attachments
                    .map((attachment) => attachment.filename)
                    .join(", ")}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  render={
                    <a
                      href={`/api/test-lab/delivery/captures/${captureItem.id}/mime`}
                    />
                  }
                  size="sm"
                  variant="outline"
                >
                  <Download /> Exact .eml
                </Button>
                <Button
                  onClick={() => void simulate(captureItem.id, "human_reply")}
                  size="sm"
                  variant="outline"
                >
                  Human reply
                </Button>
                <Button
                  onClick={() =>
                    void simulate(captureItem.id, "automated_reply")
                  }
                  size="sm"
                  variant="outline"
                >
                  Automated reply
                </Button>
                <Button
                  onClick={() => void simulate(captureItem.id, "bounce")}
                  size="sm"
                  variant="outline"
                >
                  Bounce
                </Button>
              </div>
              {captureItem.events.map((event) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-xs"
                  key={event.id}
                >
                  <span>{event.eventType.replaceAll("_", " ")}</span>
                  <span className="text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function formatBytes(value: number) {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
