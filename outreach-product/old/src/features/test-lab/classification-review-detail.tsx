import { ArrowLeft, ExternalLink, RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  classificationLabel,
  classificationLabels,
} from "@/features/test-lab/classification-labels";
import type { ClassificationAdjudication } from "@/features/test-lab/types";
import type { ApiRequest } from "@/lib/api";
import type {
  ClassificationLabel,
  ClassificationReviewCase,
} from "@/test-lab/classification-review";

export function ClassificationReviewDetail({
  adjudication,
  onBack,
  onDecisionChanged,
  request,
  reviewCase,
}: {
  adjudication: ClassificationAdjudication | undefined;
  onBack: () => void;
  onDecisionChanged: (itemId: string) => Promise<void>;
  request: ApiRequest;
  reviewCase: ClassificationReviewCase;
}) {
  const [label, setLabel] = useState<ClassificationLabel | "">(
    adjudication?.label ?? ""
  );
  const [notes, setNotes] = useState(adjudication?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!label) {
      return;
    }
    setSaving(true);
    try {
      await request(
        `/api/test-lab/classification-review/${encodeURIComponent(reviewCase.itemId)}`,
        {
          body: JSON.stringify({ label, notes }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      );
      toast.success("Classification decision saved");
      await onDecisionChanged(reviewCase.itemId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Classification decision failed"
      );
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    try {
      await request(
        `/api/test-lab/classification-review/${encodeURIComponent(reviewCase.itemId)}`,
        { method: "DELETE" }
      );
      toast.success("Classification decision cleared");
      await onDecisionChanged(reviewCase.itemId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Classification decision could not be cleared"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <article className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
        <Button
          className="split-workspace-back mb-3"
          onClick={onBack}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft /> Disagreements
        </Button>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{reviewCase.board}</Badge>
              {reviewCase.country ? (
                <Badge variant="outline">{reviewCase.country}</Badge>
              ) : null}
              {adjudication ? (
                <Badge variant="outline">
                  Decided: {classificationLabel(adjudication.label)}
                </Badge>
              ) : (
                <Badge variant="outline">Needs decision</Badge>
              )}
            </div>
            <h2 className="text-pretty font-semibold text-xl leading-tight">
              {reviewCase.title}
            </h2>
            <p className="mt-1 text-muted-foreground text-sm">
              {reviewCase.company || "Employer not stated"} ·{" "}
              {reviewCase.itemId}
            </p>
          </div>
          {reviewCase.sourceUrl ? (
            <Button
              nativeButton={false}
              render={
                <a
                  href={reviewCase.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              size="sm"
              variant="outline"
            >
              Source <ExternalLink />
            </Button>
          ) : null}
        </header>

        <Separator className="my-5" />

        <section aria-labelledby="blind-passes-heading">
          <h3 className="font-semibold text-sm" id="blind-passes-heading">
            Blind pass evidence
          </h3>
          <p className="mt-1 text-muted-foreground text-sm">
            Both Codex passes saw the same immutable listing and labeled it
            independently.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {reviewCase.labels.map((result) => (
              <div className="rounded-lg border p-4" key={result.passId}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{result.passId}</span>
                  <Badge variant="secondary">
                    {classificationLabel(result.label)}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {result.confidence} confidence
                  </span>
                </div>
                <p className="mt-3 text-pretty text-sm leading-6">
                  {result.rationale}
                </p>
                <blockquote className="mt-3 rounded-md bg-muted px-3 py-2 text-sm leading-6">
                  {result.evidence}
                </blockquote>
                <p className="mt-3 text-muted-foreground text-xs">
                  {result.model} · {result.reasoningEffort} ·{" "}
                  {result.promptVersion}
                </p>
              </div>
            ))}
          </div>
        </section>

        <Separator className="my-5" />

        <section aria-labelledby="source-text-heading">
          <h3 className="font-semibold text-sm" id="source-text-heading">
            Immutable source text
          </h3>
          <div className="mt-3 max-w-[75ch] whitespace-pre-wrap text-pretty text-sm leading-6">
            {reviewCase.description}
          </div>
        </section>

        <Separator className="my-5" />

        <section aria-labelledby="decision-heading" className="pb-4">
          <h3 className="font-semibold text-sm" id="decision-heading">
            Final broad classification
          </h3>
          <p className="mt-1 text-muted-foreground text-sm">
            Position extraction happens separately. Choose the broad class
            supported by this listing as a whole.
          </p>
          <RadioGroup
            className="mt-3 grid gap-2 sm:grid-cols-2"
            onValueChange={(value) => setLabel(value as ClassificationLabel)}
            value={label}
          >
            {classificationLabels.map((option) => {
              const id = `classification-${option.value}`;
              return (
                <div
                  className="flex items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary has-data-checked:bg-muted/60"
                  key={option.value}
                >
                  <RadioGroupItem id={id} value={option.value} />
                  <Label
                    className="grid cursor-pointer gap-1 leading-normal"
                    htmlFor={id}
                  >
                    <span>{option.label}</span>
                    <span className="font-normal text-muted-foreground text-xs">
                      {option.description}
                    </span>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
          <Label className="mt-4" htmlFor="classification-notes">
            Decision notes
          </Label>
          <Textarea
            className="mt-2 min-h-24"
            id="classification-notes"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional: record the decisive evidence or ambiguity."
            value={notes}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              Saving updates this decision in place and advances to the next
              unresolved case.
            </p>
            <div className="flex items-center gap-2">
              {adjudication ? (
                <Button
                  disabled={saving}
                  onClick={() => void clear()}
                  variant="outline"
                >
                  <RotateCcw /> Clear decision
                </Button>
              ) : null}
              <Button disabled={!label || saving} onClick={() => void save()}>
                <Save /> {saving ? "Saving…" : "Save and next"}
              </Button>
            </div>
          </div>
        </section>
      </article>
    </ScrollArea>
  );
}
