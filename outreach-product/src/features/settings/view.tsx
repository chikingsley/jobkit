import { useNavigate } from "@tanstack/react-router";
import {
  Bot,
  ChevronRight,
  Files,
  MessageSquareText,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { SettingsPage } from "@/components/settings-page";
import { Button } from "@/components/ui/button";
import { AgentRunnerConnectionCard } from "@/features/agents/runner-connection-card";
import { workspacePaths } from "@/features/workspace/routes";
import type { ApiRequest } from "@/lib/api";

const sections = [
  {
    icon: UserRound,
    label: "Profile",
    path: workspacePaths.profile,
  },
  {
    icon: SlidersHorizontal,
    label: "Preferences",
    path: workspacePaths.preferences,
  },
  {
    icon: Files,
    label: "Documents",
    path: workspacePaths.documents,
  },
  {
    icon: MessageSquareText,
    label: "Writing style",
    path: workspacePaths.messageStyle,
  },
  {
    icon: Bot,
    label: "Automation",
    path: workspacePaths.automation,
  },
] as const;

export function SettingsView({ request }: { request: ApiRequest }) {
  const navigate = useNavigate();
  return (
    <SettingsPage>
      <nav aria-label="Settings sections" className="divide-y border-y">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Button
              className="h-auto w-full justify-start whitespace-normal rounded-none px-1 py-4 text-left"
              key={section.path}
              onClick={() => void navigate({ to: section.path })}
              variant="ghost"
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 font-medium">
                {section.label}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          );
        })}
      </nav>
      <AgentRunnerConnectionCard request={request} />
    </SettingsPage>
  );
}
