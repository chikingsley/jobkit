import { Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageChanges, MessageText } from "@/features/jobs/message-diff";
import type { DraftMutationResult, JobDraft } from "@/features/jobs/types";

export function DraftEditor({
  busy,
  draft,
  instruction,
  jobId,
  onDraftAction,
  onInstruction,
}: {
  busy: boolean;
  draft: JobDraft;
  instruction: string;
  jobId: string;
  onDraftAction: (
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ) => Promise<DraftMutationResult | null>;
  onInstruction: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [highlightChanges, setHighlightChanges] = useState(false);
  const [manualMessage, setManualMessage] = useState("");

  async function mutate(
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ) {
    const result = await onDraftAction(path, options);
    if (result) {
      setEditing(false);
      setHighlightChanges(true);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label="Edit application message"
            className="min-h-72 resize-y bg-background leading-7"
            onChange={(event) => setManualMessage(event.target.value)}
            value={manualMessage}
          />
          <div className="flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => setEditing(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                manualMessage.trim() === draft.message.trim() ||
                manualMessage.trim().length < 100
              }
              onClick={() =>
                void mutate(`/api/jobs/${jobId}/draft`, {
                  body: { message: manualMessage },
                  method: "PUT",
                })
              }
            >
              Save changes
            </Button>
          </div>
        </div>
      ) : (
        <>
          <MessageText
            highlightChanges={highlightChanges}
            message={draft.message}
            previousMessage={draft.previousMessage}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                setManualMessage(draft.message);
                setEditing(true);
              }}
              size="sm"
              variant="outline"
            >
              <Pencil /> Edit manually
            </Button>
            <Button
              disabled={busy || draft.version <= 1}
              onClick={() =>
                void mutate(`/api/jobs/${jobId}/undo`, { method: "POST" })
              }
              size="sm"
              variant="outline"
            >
              <RotateCcw /> Undo revision
            </Button>
          </div>
        </>
      )}

      <MessageChanges
        message={draft.message}
        previousMessage={draft.previousMessage}
      />
      {draft.changeSummary ? (
        <div className="rounded-lg bg-muted/60 p-3 text-sm">
          <div className="font-medium">What changed</div>
          <p className="mt-1 text-muted-foreground">{draft.changeSummary}</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Textarea
          className="min-h-20 flex-1"
          onChange={(event) => onInstruction(event.target.value)}
          placeholder="Describe one change, for example: Ask only about the schedule and start date."
          value={instruction}
        />
        <Button
          className="self-end"
          disabled={!instruction.trim() || busy}
          onClick={() =>
            void mutate(`/api/jobs/${jobId}/revise`, {
              body: { instruction },
            })
          }
          variant="secondary"
        >
          Revise message
        </Button>
      </div>
    </div>
  );
}
