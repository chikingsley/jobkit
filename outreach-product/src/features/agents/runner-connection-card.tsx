import { Copy, Terminal, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
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
import type { AgentCapability } from "@/features/agents/schema";
import type { ApiRequest } from "@/lib/api";

export interface AgentRunnerSummary {
  capabilities: AgentCapability[];
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

const RUNNER_ONLINE_WINDOW_MS = 60 * 1000;

export function useAgentRunners(request: ApiRequest) {
  const result = useSWR(
    "/api/agent-runners",
    async (path) =>
      (await (await request(path)).json()) as {
        runners: AgentRunnerSummary[];
      },
    { refreshInterval: 3000 }
  );
  const activeRunners = (result.data?.runners ?? []).filter(isRunnerOnline);
  return {
    ...result,
    activeRunners,
    hasCapability: (capability: AgentCapability) =>
      activeRunners.some((runner) => runner.capabilities.includes(capability)),
  };
}

export function AgentRunnerConnectionCard({
  description = "Pair a local Codex login with JobKit. The agent receives only queued task inputs and returns schema-validated results over outbound HTTPS.",
  request,
  title = "Codex agent",
}: {
  description?: string;
  request: ApiRequest;
  title?: string;
}) {
  const { activeRunners, data, mutate } = useAgentRunners(request);
  const [pairing, setPairing] = useState<AgentPairing | null>(null);
  const [busy, setBusy] = useState(false);

  async function createPairing() {
    setBusy(true);
    try {
      const response = await request("/api/agent-runner-pairings", {
        body: JSON.stringify({
          capabilities: [
            "research",
            "extraction",
            "drafting",
            "evaluation",
            "operations",
          ],
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
      await request(`/api/agent-runners/${runnerId}`, { method: "DELETE" });
      await mutate();
      toast.success("Codex agent revoked");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Agent revoke failed"
      );
    }
  }

  const pairingCommand = pairing
    ? `bun run jobkit -- agent connect --code ${pairing.code} && bun run jobkit -- agent start`
    : "";

  async function copyPairingCommand() {
    await navigator.clipboard.writeText(pairingCommand);
    toast.success("Pairing command copied");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
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
        {(data?.runners ?? []).map((runner) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
            key={runner.id}
          >
            <div>
              <div className="flex items-center gap-2 font-medium">
                <Terminal className="size-4" /> {runner.name}
                <Badge
                  variant={isRunnerOnline(runner) ? "secondary" : "outline"}
                >
                  {runnerStatus(runner)}
                </Badge>
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {runner.lastSeenAt
                  ? `Last seen ${new Date(runner.lastSeenAt).toLocaleString()}`
                  : "Waiting for first connection"}
                {runner.codexVersion ? ` · ${runner.codexVersion}` : ""}
              </div>
            </div>
            {runner.revokedAt ? null : (
              <Button
                aria-label={`Revoke ${runner.name}`}
                onClick={() => void revoke(runner.id)}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            )}
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

function isRunnerOnline(runner: AgentRunnerSummary) {
  return Boolean(
    !runner.revokedAt &&
      runner.lastSeenAt &&
      Date.parse(runner.lastSeenAt) >= Date.now() - RUNNER_ONLINE_WINDOW_MS
  );
}

function runnerStatus(runner: AgentRunnerSummary) {
  if (runner.revokedAt) {
    return "Revoked";
  }
  return isRunnerOnline(runner) ? "Online" : "Offline";
}
