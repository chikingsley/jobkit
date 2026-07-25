import { Pause, Plus, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsPage } from "@/components/settings-page";
import { SettingsSection } from "@/components/settings-section";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useAutomationPolicy,
  useSaveAutomationPolicy,
} from "@/features/automation/queries";
import {
  type AutomationPolicy,
  defaultAutomationPolicy,
} from "@/features/automation/schema";

const modeOptions = [
  { label: "Off", value: "off" },
  { label: "Review each", value: "review" },
  { label: "Send automatically", value: "auto" },
] as const;

export function AutomationView() {
  const { data, isLoading } = useAutomationPolicy();
  const savePolicy = useSaveAutomationPolicy();
  const [draft, setDraft] = useState<AutomationPolicy>(defaultAutomationPolicy);
  const [dirty, setDirty] = useState(false);
  const saving = savePolicy.isPending;

  useEffect(() => {
    if (data?.policy) {
      setDraft(data.policy);
      setDirty(false);
    }
  }, [data]);

  function update(next: AutomationPolicy) {
    setDraft(next);
    setDirty(true);
  }

  async function save() {
    try {
      await savePolicy.mutateAsync(draft);
      toast.success("Automation policy saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Automation policy failed"
      );
    }
  }

  if (isLoading) {
    return (
      <SettingsPage>
        <p className="py-10 text-center text-muted-foreground" role="status">
          Loading automation policy…
        </p>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage>
      <SettingsSection title="Global pause">
        <label
          className="flex items-center justify-between gap-4 rounded-lg border p-3"
          htmlFor="automation-paused"
        >
          <span>
            <span className="block font-medium">Pause automation</span>
            <span className="block text-muted-foreground text-sm">
              Require an explicit review for new activity.
            </span>
          </span>
          <Switch
            checked={draft.paused}
            id="automation-paused"
            onCheckedChange={(checked) => update({ ...draft, paused: checked })}
          />
        </label>
      </SettingsSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChannelPolicyCard
          dailyLimit={draft.email.dailyLimit}
          description="Direct messages sent to a verified email address."
          mode={draft.email.mode}
          onChange={(email) => update({ ...draft, email })}
          title="Email"
        />
        <ChannelPolicyCard
          dailyLimit={draft.boardForm.dailyLimit}
          description="Applications completed through a supported job-board form."
          mode={draft.boardForm.mode}
          onChange={(boardForm) => update({ ...draft, boardForm })}
          title="Board forms"
        />
      </div>

      <FollowUpPolicyCard
        delays={draft.followUpDelaysDays}
        onChange={(followUpDelaysDays) =>
          update({ ...draft, followUpDelaysDays })
        }
      />

      <SettingsSection title="Automatic-send requirements">
        <div className="grid gap-5 md:grid-cols-2">
          <Field>
            <FieldLabel>Minimum match</FieldLabel>
            <Select
              items={[
                { label: "Likely match", value: "likely" },
                { label: "Strong match", value: "strong" },
              ]}
              onValueChange={(value) => {
                if (value === "likely" || value === "strong") {
                  update({ ...draft, minimumFit: value });
                }
              }}
              value={draft.minimumFit}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="likely">Likely match</SelectItem>
                  <SelectItem value="strong">Strong match</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Unresolved qualifications keep the target in review.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="route-freshness">Route freshness</FieldLabel>
            <Input
              id="route-freshness"
              min={1}
              onChange={(event) =>
                update({
                  ...draft,
                  routeFreshnessDays: Number(event.target.value),
                })
              }
              type="number"
              value={draft.routeFreshnessDays}
            />
            <FieldDescription>
              Recheck an email or form after this many days.
            </FieldDescription>
          </Field>
          <PolicySwitch
            checked={draft.requireKnownCompensation}
            description="Hold listings whose pay could not be read from the source."
            label="Require known compensation"
            onChange={(requireKnownCompensation) =>
              update({ ...draft, requireKnownCompensation })
            }
          />
          <PolicySwitch
            checked={draft.excludedMarketSegments.includes("language_center")}
            description="Keep language and training centers out of automatic execution."
            label="Exclude training centers"
            onChange={(checked) =>
              update({
                ...draft,
                excludedMarketSegments: checked
                  ? ["language_center", "training_center"]
                  : [],
              })
            }
          />
        </div>
      </SettingsSection>
      <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
        {dirty ? (
          <span className="text-muted-foreground text-sm">Unsaved changes</span>
        ) : null}
        <Button
          disabled={!dirty || saving}
          id="save-automation-policy"
          onClick={() => void save()}
        >
          {draft.paused ? <Pause /> : <Save />}
          {saving ? "Saving…" : "Save policy"}
        </Button>
      </div>
    </SettingsPage>
  );
}

function FollowUpPolicyCard({
  delays,
  onChange,
}: {
  delays: number[];
  onChange: (delays: number[]) => void;
}) {
  return (
    <SettingsSection title="Follow-up drafts">
      <p className="mb-4 text-muted-foreground text-sm">
        Choose each wait after the last sent message. When a wait is due and no
        person has replied, Codex prepares a draft for review.
      </p>
      <div className="space-y-3">
        {delays.map((delay, index) => (
          <div
            className="flex items-end gap-3"
            key={`follow-up-${index.toString()}`}
          >
            <Field className="max-w-xs">
              <FieldLabel htmlFor={`follow-up-delay-${index.toString()}`}>
                Follow-up {index + 1}
              </FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id={`follow-up-delay-${index.toString()}`}
                  min={1}
                  onChange={(event) => {
                    const next = [...delays];
                    next[index] = Number(event.target.value);
                    onChange(next);
                  }}
                  type="number"
                  value={delay}
                />
                <span className="shrink-0 text-muted-foreground text-sm">
                  days later
                </span>
              </div>
            </Field>
            <Button
              aria-label={`Remove follow-up ${index + 1}`}
              onClick={() =>
                onChange(delays.filter((_, position) => position !== index))
              }
              size="icon"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          onClick={() => onChange([...delays, 1])}
          type="button"
          variant="outline"
        >
          <Plus /> Add follow-up
        </Button>
      </div>
    </SettingsSection>
  );
}

function ChannelPolicyCard({
  dailyLimit,
  description,
  mode,
  onChange,
  title,
}: {
  dailyLimit: number;
  description: string;
  mode: AutomationPolicy["email"]["mode"];
  onChange: (policy: AutomationPolicy["email"]) => void;
  title: string;
}) {
  return (
    <SettingsSection title={title}>
      <p className="mb-4 text-muted-foreground text-sm">{description}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel>Behavior</FieldLabel>
          <Select
            items={modeOptions}
            onValueChange={(value) => {
              if (value === "off" || value === "review" || value === "auto") {
                onChange({ dailyLimit, mode: value });
              }
            }}
            value={mode}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {modeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Daily pace</FieldLabel>
          <Input
            min={1}
            onChange={(event) =>
              onChange({ dailyLimit: Number(event.target.value), mode })
            }
            type="number"
            value={dailyLimit}
          />
        </Field>
      </div>
    </SettingsSection>
  );
}

function PolicySwitch({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const id = `policy-${label.toLowerCase().replaceAll(/[^a-z]+/gu, "-")}`;
  return (
    <label
      className="flex items-start justify-between gap-4 rounded-lg border p-3"
      htmlFor={id}
    >
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-muted-foreground text-sm">
          {description}
        </span>
      </span>
      <Switch checked={checked} id={id} onCheckedChange={onChange} />
    </label>
  );
}
