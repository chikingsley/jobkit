import {
  Bot,
  Files,
  MessageSquareText,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { useNavigate } from "react-router";
import { SettingsPage } from "@/components/settings-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentRunnerConnectionCard } from "@/features/agents/runner-connection-card";
import { workspacePaths } from "@/features/workspace/routes";
import type { ApiRequest } from "@/lib/api";

const sections = [
  {
    description: "Identity, experience, credentials, and teaching subjects.",
    icon: UserRound,
    label: "Profile",
    path: workspacePaths.profile,
  },
  {
    description: "Target markets, job types, benefits, and exclusions.",
    icon: SlidersHorizontal,
    label: "Preferences",
    path: workspacePaths.preferences,
  },
  {
    description: "Resumes, diplomas, photos, and application packets.",
    icon: Files,
    label: "Documents",
    path: workspacePaths.documents,
  },
  {
    description: "Approved message foundations and revision preferences.",
    icon: MessageSquareText,
    label: "Writing style",
    path: workspacePaths.messageStyle,
  },
  {
    description: "Review rules, pacing, and follow-up behavior.",
    icon: Bot,
    label: "Automation",
    path: workspacePaths.automation,
  },
] as const;

export function SettingsView({ request }: { request: ApiRequest }) {
  const navigate = useNavigate();
  return (
    <SettingsPage
      description="Manage your application identity, materials, writing, automation, and local Codex connection."
      title="Settings"
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.path}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-4" /> {section.label}
                </CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => navigate(section.path)}
                  variant="outline"
                >
                  Open {section.label.toLowerCase()}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <AgentRunnerConnectionCard request={request} />
    </SettingsPage>
  );
}
