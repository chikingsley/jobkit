import { Copy, Terminal, Trash2 } from "lucide-react";
import { useState } from "react";
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
import {
  type AgentPairing,
  type AgentRunnerSummary,
  isRunnerOnline,
  useAgentRunners,
  useCreateAgentPairing,
  useRevokeAgentRunner,
} from "@/features/agents/queries";

export function AgentRunnerConnectionCard({
  description = "Pair a local Codex login with JobKit. The agent receives only queued task inputs and returns schema-validated results over outbound HTTPS.",
  title = "Codex agent",
}: {
  description?: string;
  title?: string;
}) {
  const { activeRunners, runners } = useAgentRunners();
  const createPairingMutation = useCreateAgentPairing();
  const revokeMutation = useRevokeAgentRunner();
  const [pairing, setPairing] = useState<AgentPairing | null>(null);
  const busy = createPairingMutation.isPending;

  async function createPairing() {
    try {
      const result = await createPairingMutation.mutateAsync([
        "research",
        "extraction",
        "drafting",
        "evaluation",
        "operations",
      ]);
      setPairing(result.pairing);
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Agent pairing failed"
      );
    }
  }

  async function revoke(runnerId: string) {
    try {
      await revokeMutation.mutateAsync(runnerId);
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
        {runners.map((runner) => (
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

function runnerStatus(runner: AgentRunnerSummary) {
  if (runner.revokedAt) {
    return "Revoked";
  }
  return isRunnerOnline(runner) ? "Online" : "Offline";
}
