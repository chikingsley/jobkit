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
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {draft.paused ? <Pause /> : <Save />}
            {saving ? "Saving…" : "Save policy"}
          </Button>
        </CardFooter>
      </Card>

      <RunnerAccessCard request={request} />
    </SettingsPage>
  );
}

interface RunnerTokenSummary {
  createdAt: string;
  id: string;
  lastUsedAt: string | null;
  name: string;
  revokedAt: string | null;
}

function RunnerAccessCard({ request }: { request: ApiRequest }) {
  const { data, mutate } = useSWR(
    "/api/country-sweep-runner-tokens",
    async (path) =>
      (await (await request(path)).json()) as { tokens: RunnerTokenSummary[] }
  );
  const [createdToken, setCreatedToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function createToken() {
    setBusy(true);
    try {
      const response = await request("/api/country-sweep-runner-tokens", {
        body: JSON.stringify({ name: "gmk-server Codex runner" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        message: string;
        token: RunnerTokenSummary & { token: string };
      };
      setCreatedToken(result.token.token);
      await mutate();
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Runner token failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
    try {
      await request(`/api/country-sweep-runner-tokens/${tokenId}`, {
        method: "DELETE",
      });
      await mutate();
      toast.success("Runner token revoked");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Runner token failed"
      );
    }
  }

  async function copyToken() {
    await navigator.clipboard.writeText(createdToken);
    toast.success("Runner token copied");
  }

  const activeTokens = (data?.tokens ?? []).filter((token) => !token.revokedAt);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Codex country runner</CardTitle>
        <CardDescription>
          A runner token can claim country research tasks. It cannot access
          profiles, documents, messages, or application routes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {createdToken ? (
          <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="font-medium">Copy this token now</div>
            <code className="break-all rounded bg-background p-2 text-xs">
              {createdToken}
            </code>
            <Button
              className="justify-self-start"
              onClick={() => void copyToken()}
              variant="outline"
            >
              <Copy /> Copy token
            </Button>
          </div>
        ) : null}
        {activeTokens.map((token) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
            key={token.id}
          >
            <div>
              <div className="flex items-center gap-2 font-medium">
                <Terminal className="size-4" /> {token.name}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {token.lastUsedAt
                  ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                  : "Never used"}
              </div>
            </div>
            <Button
              aria-label={`Revoke ${token.name}`}
              onClick={() => void revoke(token.id)}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {activeTokens.length === 0 && !createdToken ? (
          <div className="text-muted-foreground text-sm">
            No active runner is connected.
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          disabled={busy}
          onClick={() => void createToken()}
          variant="outline"
        >
          <Terminal /> {busy ? "Creating…" : "Create runner token"}
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
