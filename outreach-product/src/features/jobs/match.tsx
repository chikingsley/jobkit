import { CheckCircle2, CircleHelp, Minus, XCircle } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { QualificationClaimAnswer } from "@/features/matching/claims";
import type { JobMatch, MatchState } from "@/profile-types";

export function MatchPanel({
  busyClaimKey,
  match,
  onQualificationClaim,
  summary,
}: {
  busyClaimKey: string;
  match: JobMatch;
  onQualificationClaim: (input: {
    answer: QualificationClaimAnswer | null;
    claimKey: string;
    kind: string;
    label: string;
  }) => Promise<void>;
  summary: string;
}) {
  const visible = match.criteria.filter(
    (item) => item.visibility !== "internal"
  );
  const requirements = visible.filter((item) => item.importance !== undefined);
  const otherConflicts = visible.filter(
    (item) => item.importance === undefined && item.state !== "match"
  );
  const displayed = [...requirements, ...otherConflicts];
  return (
    <section className="mt-7 border-t pt-6">
      <h3 className="font-semibold">Match overview</h3>
      <p className="mt-1 text-muted-foreground text-sm">{summary}</p>
      {displayed.length > 0 ? (
        <div className="mt-3 divide-y">
          {displayed.map((item) => (
            <div
              className="grid gap-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
              key={`${item.label}:${item.evidence ?? ""}`}
            >
              <div className="flex items-start gap-2">
                <CriterionIcon state={item.state} />
                <span className="leading-5">
                  {item.label}
                  {item.importance === "preferred" ? (
                    <span className="text-muted-foreground"> (preferred)</span>
                  ) : null}
                </span>
              </div>
              {item.claimKey && item.state !== "match" ? (
                <QualificationAnswer
                  answer={item.claimAnswer ?? null}
                  busy={busyClaimKey === item.claimKey}
                  onChange={(answer) =>
                    onQualificationClaim({
                      answer,
                      claimKey: item.claimKey ?? "",
                      kind: item.claimKind ?? "other",
                      label: item.label,
                    })
                  }
                  state={item.state}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function QualificationAnswer({
  answer,
  busy,
  onChange,
  state,
}: {
  answer: QualificationClaimAnswer | null;
  busy: boolean;
  onChange: (value: QualificationClaimAnswer | null) => Promise<void>;
  state: MatchState;
}) {
  const groupId = useId();
  const displayedAnswer = answer ?? displayedAnswerForState(state);
  const answerSource = qualificationAnswerSource(answer, state);
  const options = [
    { label: "Yes", value: "yes" },
    { label: "No", value: "no" },
  ] as const;
  return (
    <div className="grid gap-1.5">
      <RadioGroup
        aria-label="Do you meet this requirement?"
        className="grid auto-cols-fr grid-flow-col gap-0 overflow-hidden rounded-md border border-input shadow-xs"
        disabled={busy}
        onValueChange={(next) =>
          void onChange(next as QualificationClaimAnswer)
        }
        value={displayedAnswer}
      >
        {options.map((option) => (
          <label
            className="flex min-h-11 min-w-0 cursor-pointer items-center justify-center border-input border-l px-2 font-medium text-muted-foreground text-xs transition-colors first:border-l-0 hover:bg-muted hover:text-foreground has-focus-visible:z-10 has-data-checked:bg-primary has-data-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring has-data-checked:hover:bg-primary/90 has-data-checked:hover:text-primary-foreground"
            htmlFor={`${groupId}-${option.value}`}
            key={option.value}
          >
            <RadioGroupItem
              className="absolute size-px overflow-hidden opacity-0"
              id={`${groupId}-${option.value}`}
              value={option.value}
            />
            {option.label}
          </label>
        ))}
      </RadioGroup>
      <div className="flex min-h-6 items-center justify-between gap-2 text-muted-foreground text-xs">
        <span>{answerSource}</span>
        {answer ? (
          <Button
            className="h-auto px-1 py-0 text-xs"
            disabled={busy}
            onClick={() => void onChange(null)}
            variant="link"
          >
            Clear answer
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function displayedAnswerForState(state: MatchState) {
  if (state === "match") {
    return "yes";
  }
  return state === "conflict" ? "no" : "";
}

function qualificationAnswerSource(
  answer: QualificationClaimAnswer | null,
  state: MatchState
) {
  if (answer) {
    return "Saved to your profile";
  }
  return state === "match"
    ? "Confirmed by your profile"
    : "Choose once to save this fact";
}

function CriterionIcon({ state }: { state: MatchState }) {
  if (state === "match") {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
  }
  if (state === "conflict") {
    return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
  }
  if (state === "preference") {
    return <Minus className="mt-0.5 size-4 shrink-0 text-amber-600" />;
  }
  return (
    <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  );
}
