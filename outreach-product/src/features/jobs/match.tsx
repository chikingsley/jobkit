import { CheckCircle2, CircleHelp, Minus, XCircle } from "lucide-react";
import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { QualificationClaimAnswer } from "@/pipeline/03_match/claims";
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
              className="flex min-h-11 items-center gap-2 py-1.5 text-sm"
              data-match-requirement=""
              key={`${item.label}:${item.evidence ?? ""}`}
            >
              {shouldAskQualification(item) ? (
                <QualificationAnswer
                  busy={busyClaimKey === item.claimKey}
                  label={item.label}
                  onChange={(answer) =>
                    onQualificationClaim({
                      answer,
                      claimKey: item.claimKey ?? "",
                      kind: item.claimKind ?? "other",
                      label: item.label,
                    })
                  }
                />
              ) : (
                <CriterionStatus
                  answer={item.claimAnswer}
                  busy={busyClaimKey === item.claimKey}
                  label={item.label}
                  onClear={
                    item.claimKey && item.claimAnswer
                      ? () =>
                          onQualificationClaim({
                            answer: null,
                            claimKey: item.claimKey ?? "",
                            kind: item.claimKind ?? "other",
                            label: item.label,
                          })
                      : undefined
                  }
                  state={item.state}
                />
              )}
              <span className="min-w-0 leading-5">
                {item.label}
                {item.importance === "preferred" ? (
                  <span className="text-muted-foreground"> (preferred)</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function QualificationAnswer({
  busy,
  label,
  onChange,
}: {
  busy: boolean;
  label: string;
  onChange: (value: QualificationClaimAnswer | null) => Promise<void>;
}) {
  const groupId = useId();
  const options = [
    { label: "Yes", value: "yes" },
    { label: "No", value: "no" },
  ] as const;
  return (
    <RadioGroup
      aria-label={`Do you meet the requirement: ${label}?`}
      className="grid h-7 w-20 shrink-0 auto-cols-fr grid-flow-col gap-0 overflow-visible rounded-md border border-input shadow-xs"
      disabled={busy}
      onValueChange={(next) => void onChange(next as QualificationClaimAnswer)}
      value=""
    >
      {options.map((option) => (
        <label
          className="relative flex min-w-0 cursor-pointer items-center justify-center border-input border-l font-medium text-muted-foreground text-xs transition-colors after:absolute after:inset-x-0 after:-inset-y-2 first:border-l-0 hover:bg-muted hover:text-foreground has-focus-visible:z-10 has-focus-visible:ring-2 has-focus-visible:ring-ring"
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
  );
}

function shouldAskQualification(item: JobMatch["criteria"][number]) {
  return (
    Boolean(item.claimKey) &&
    item.claimAnswer === undefined &&
    (item.state === "unknown" || item.state === "preference")
  );
}

function CriterionStatus({
  answer,
  busy,
  label,
  onClear,
  state,
}: {
  answer?: QualificationClaimAnswer;
  busy: boolean;
  label: string;
  onClear?: () => Promise<void>;
  state: MatchState;
}) {
  const icon = <CriterionIcon state={state} />;
  if (!(answer && onClear)) {
    return icon;
  }
  return (
    <button
      aria-label={`Change saved answer for ${label}`}
      className="relative flex size-4 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
      disabled={busy}
      onClick={() => void onClear()}
      title="Change answer"
      type="button"
    >
      {icon}
    </button>
  );
}

function CriterionIcon({ state }: { state: MatchState }) {
  if (state === "match") {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />;
  }
  if (state === "conflict") {
    return <XCircle className="size-4 shrink-0 text-destructive" />;
  }
  if (state === "preference") {
    return <Minus className="size-4 shrink-0 text-amber-600" />;
  }
  return <CircleHelp className="size-4 shrink-0 text-muted-foreground" />;
}
