import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MessageChanges, MessageText } from "@/features/jobs/message-diff";
import { waitForAgentTask } from "@/lib/agent-task-client";
import type { ApiRequest } from "@/lib/api";

interface PreviewSample {
  description: string;
  key: string;
  label: string;
  message: string;
}

export function MessagePreview({ request }: { request: ApiRequest }) {
  const [samples, setSamples] = useState<PreviewSample[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [message, setMessage] = useState("");
  const [previousMessage, setPreviousMessage] = useState("");
  const [instruction, setInstruction] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlightChanges, setHighlightChanges] = useState(false);

  useEffect(() => {
    void request("/api/message-preview")
      .then(async (response) => {
        const data = (await response.json()) as { previews: PreviewSample[] };
        setSamples(data.previews);
        const [first] = data.previews;
        if (first) {
          selectSample(first, setSelectedKey, setMessage);
        }
      })
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Message preview could not load"
        )
      );
  }, [request]);

  const selected = samples.find((sample) => sample.key === selectedKey);

  function reset(sample = selected) {
    if (!sample) {
      return;
    }
    setMessage(sample.message);
    setPreviousMessage("");
    setInstruction("");
    setChangeSummary("");
    setModel("");
    setHighlightChanges(false);
  }

  async function revise() {
    if (!(selected && instruction.trim())) {
      return;
    }
    setBusy(true);
    try {
      const response = await request("/api/message-preview/revise", {
        body: JSON.stringify({
          currentMessage: message,
          instruction,
          key: selected.key,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const queued = (await response.json()) as {
        taskRequest: { id: string };
      };
      const result = (await waitForAgentTask(
        request,
        queued.taskRequest.id
      )) as {
        changeSummary: string;
        message: string;
        modelId: string;
        previousMessage: string;
        provider: string;
      };
      setPreviousMessage(result.previousMessage);
      setMessage(result.message);
      setChangeSummary(result.changeSummary);
      setModel(`${result.provider}/${result.modelId}`);
      setInstruction("");
      setHighlightChanges(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Preview revision failed"
      );
    } finally {
      setBusy(false);
    }
  }

  if (!selected) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <CardTitle>Message preview</CardTitle>
            <CardDescription className="mt-1">
              Test the production message policy and active model without
              creating or sending an application.
            </CardDescription>
          </div>
          {model ? <Badge variant="outline">{model}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <label className="font-medium text-sm" htmlFor="preview-sample">
            Sample application
          </label>
          <Select
            items={samples.map((sample) => ({
              label: sample.label,
              value: sample.key,
            }))}
            onValueChange={(value) => {
              const sample = samples.find(
                (candidate) => candidate.key === String(value)
              );
              if (sample) {
                setSelectedKey(sample.key);
                reset(sample);
              }
            }}
            value={selectedKey}
          >
            <SelectTrigger id="preview-sample">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {samples.map((sample) => (
                  <SelectItem key={sample.key} value={sample.key}>
                    {sample.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {selected.description}
          </p>
        </div>

        <MessageText
          highlightChanges={highlightChanges}
          message={message}
          previousMessage={previousMessage}
        />
        <MessageChanges message={message} previousMessage={previousMessage} />
        {changeSummary ? (
          <p className="rounded-lg bg-muted/50 p-3 text-muted-foreground text-sm">
            {changeSummary}
          </p>
        ) : null}

        <Textarea
          className="min-h-20"
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Describe the correction you want to test."
          value={instruction}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={busy} onClick={() => reset()} variant="outline">
            <RotateCcw /> Reset sample
          </Button>
          <Button
            disabled={busy || !instruction.trim()}
            onClick={() => void revise()}
          >
            Revise preview
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function selectSample(
  sample: PreviewSample,
  setSelectedKey: (value: string) => void,
  setMessage: (value: string) => void
) {
  setSelectedKey(sample.key);
  setMessage(sample.message);
}
