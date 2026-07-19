import { Copy, Pause, Save, Terminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { SettingsPage } from "@/components/settings-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  type AutomationPolicy,
  defaultAutomationPolicy,
} from "@/features/automation/schema";
import type { ApiRequest } from "@/lib/api";

const modeOptions = [
  { label: "Off", value: "off" },
  { label: "Review each", value: "review" },
  { label: "Send automatically", value: "auto" },
] as const;

export function AutomationView({ request }: { request: ApiRequest }) {
  const { data, isLoading, mutate } = useSWR(
    "/api/automation-policy",
    async (path) =>
      (await (await request(path)).json()) as {
        policy: AutomationPolicy;
        updatedAt: string | null;
      }
  );
  const [draft, setDraft] = useState<AutomationPolicy>(defaultAutomationPolicy);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    try {
      const response = await request("/api/automation-policy", {
        body: JSON.stringify(draft),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      const saved = (await response.json()) as {
        policy: AutomationPolicy;
        updatedAt: string;
      };
      await mutate(saved, { revalidate: false });
      toast.success("Automation policy saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Automation policy failed"
      );
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <SettingsPage
        description="Choose what can run, which channels require review, and the maximum daily volume."
        title="Automation"
      >
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Loading automation policy…
          </CardContent>
        </Card>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      description="Choose what can run, which channels require review, and the maximum daily volume. Campaigns keep a snapshot of these settings."
      title="Automation"
    >
      <Card>
        <CardHeader>
          <CardTitle>Global pause</CardTitle>
          <CardDescription>
            Pausing prevents new campaigns from using the automatic policy.
            Existing drafts remain available for review.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              onCheckedChange={(checked) =>
                update({ ...draft, paused: checked })
              }
            />
          </label>
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>Automatic-send requirements</CardTitle>
          <CardDescription>
            These checks apply before any campaign target can leave review.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
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
              max={90}
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
        </CardContent>
        <CardFooter className="justify-end gap-3">
          {dirty ? (
            <span className="text-muted-foreground text-sm">
              Unsaved changes
            </span>
          ) : null}
          <Button
            disabled={!dirty || saving}
            id="save-automation-policy"
            onClick={() => void save()}
          >
            {draft.paused ? <Pause /> : <Save />}
            {saving ? "Saving…" : "Save policy"}
          </Button>
        </CardFooter>
      </Card>

      <AgentRunnerCard request={request} />
    </SettingsPage>
  );
}

interface AgentRunnerSummary {
  capabilities: string[];
  codexVersion: string;
  createdAt: string;
  id: string;
  lastSeenAt: string | null;
  name: string;
  revokedAt: string | null;
}

interface AgentPairing {
  code: string;
  expiresAt: string;
}

function AgentRunnerCard({ request }: { request: ApiRequest }) {
  const { data, mutate } = useSWR(
    "/api/agent-runners",
    async (path) =>
      (await (await request(path)).json()) as {
        runners: AgentRunnerSummary[];
      }
  );
  const [pairing, setPairing] = useState<AgentPairing | null>(null);
  const [busy, setBusy] = useState(false);

  async function createPairing() {
    setBusy(true);
    try {
      const response = await request("/api/agent-runner-pairings", {
        body: JSON.stringify({
          capabilities: ["research", "extraction", "drafting", "evaluation"],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        message: string;
        pairing: AgentPairing;
      };
      setPairing(result.pairing);
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Agent pairing failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(runnerId: string) {
    try {
      await request(`/api/agent-runners/${runnerId}`, {
        method: "DELETE",
      });
      await mutate();
      toast.success("Codex agent revoked");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Agent revoke failed"
      );
    }
  }

  const pairingCommand = pairing
    ? `bun run jobkit -- agent connect --code ${pairing.code}`
    : "";

  async function copyPairingCommand() {
    await navigator.clipboard.writeText(pairingCommand);
    toast.success("Pairing command copied");
  }

  const activeRunners = (data?.runners ?? []).filter(
    (runner) => !runner.revokedAt
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Codex agent</CardTitle>
        <CardDescription>
          Pair a local Codex login with JobKit. The agent receives only queued
          task inputs and returns schema-validated results over outbound HTTPS.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {pairing ? (
          <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="font-medium">Run this from outreach-product</div>
            <code className="break-all rounded bg-background p-2 text-xs">
              {pairingCommand}
            </code>
            <div className="text-muted-foreground text-xs">
              This one-time code expires at{" "}
              {new Date(pairing.expiresAt).toLocaleTimeString()}.
            </div>
            <Button
              className="justify-self-start"
              onClick={() => void copyPairingCommand()}
              variant="outline"
            >
              <Copy /> Copy command
            </Button>
          </div>
        ) : null}
        {activeRunners.map((runner) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
            key={runner.id}
          >
            <div>
              <div className="flex items-center gap-2 font-medium">
                <Terminal className="size-4" /> {runner.name}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {runner.lastSeenAt
                  ? `Last seen ${new Date(runner.lastSeenAt).toLocaleString()}`
                  : "Waiting for first connection"}
                {runner.codexVersion ? ` · ${runner.codexVersion}` : ""}
              </div>
            </div>
            <Button
              aria-label={`Revoke ${runner.name}`}
              onClick={() => void revoke(runner.id)}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {activeRunners.length === 0 && !pairing ? (
          <div className="text-muted-foreground text-sm">
            No Codex agent is paired.
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          disabled={busy}
          onClick={() => void createPairing()}
          variant="outline"
        >
          <Terminal /> {busy ? "Creating…" : "Pair Codex agent"}
        </Button>
      </CardFooter>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
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
          <FieldLabel>Daily maximum</FieldLabel>
          <Input
            max={100}
            min={1}
            onChange={(event) =>
              onChange({ dailyLimit: Number(event.target.value), mode })
            }
            type="number"
            value={dailyLimit}
          />
        </Field>
      </CardContent>
    </Card>
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
