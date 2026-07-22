import { useNavigate } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { SettingsPage } from "@/components/settings-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentTaskHistory } from "@/features/agents/task-history";
import { InventoryStatusCard } from "@/features/inventory/status-card";
import { workspacePaths } from "@/features/workspace/routes";
import type { ApiRequest } from "@/lib/api";

export function OperatorView({ request }: { request: ApiRequest }) {
  const navigate = useNavigate();
  return (
    <SettingsPage
      description="Operate inventory, inspect Codex tasks, and run isolated evaluations. These controls are hidden from member accounts."
      title="Operator tools"
    >
      <InventoryStatusCard request={request} />
      <AgentTaskHistory request={request} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="size-4" /> Test Lab
          </CardTitle>
          <CardDescription>
            Replay versioned cases and inspect test delivery without contacting
            real recipients.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => void navigate({ to: workspacePaths.testLab })}
            variant="outline"
          >
            Open Test Lab
          </Button>
        </CardContent>
      </Card>
    </SettingsPage>
  );
}
