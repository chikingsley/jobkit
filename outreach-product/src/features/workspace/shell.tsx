import { useNavigate } from "@tanstack/react-router";
import {
  Bot,
  BriefcaseBusiness,
  ChevronsUpDown,
  LogOut,
  MessagesSquare,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  type WorkspaceView,
  workspacePaths,
} from "@/features/workspace/routes";

const navigation = [
  { icon: Bot, id: "campaigns", label: "Campaigns" },
  { icon: BriefcaseBusiness, id: "jobs", label: "Jobs" },
  { icon: MessagesSquare, id: "messages", label: "Messages" },
] as const;

export function ViewLoading() {
  return (
    <div className="grid min-h-64 place-items-center text-muted-foreground text-sm">
      Loading workspace…
    </div>
  );
}

export function WorkspacePage({ children }: PropsWithChildren) {
  return <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>;
}

export function WorkspaceSidebar({
  activeView,
  applied,
  email,
  name,
  onSignOut,
  onViewChange,
  role,
  totalJobs,
}: {
  activeView: WorkspaceView;
  applied: number;
  email: string;
  name: string;
  onSignOut: () => Promise<unknown>;
  onViewChange: (view: WorkspaceView) => void;
  role: "member" | "operator";
  totalJobs: number | null;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="JobKit">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground text-sm">
                J
              </div>
              <div className="min-w-0 leading-tight">
                <div className="font-semibold">JobKit</div>
                <div className="truncate text-muted-foreground text-xs">
                  Application workspace
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeView === item.id}
                      onClick={() => {
                        onViewChange(item.id);
                        if (isMobile) {
                          setOpenMobile(false);
                        }
                      }}
                      tooltip={item.label}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          email={email}
          name={name}
          onSignOut={onSignOut}
          onViewChange={onViewChange}
          role={role}
          summary={
            totalJobs === null
              ? "Application workspace"
              : `${applied} of ${totalJobs} applications sent`
          }
        />
      </SidebarFooter>
    </Sidebar>
  );
}

function NavUser({
  email,
  name,
  onSignOut,
  onViewChange,
  role,
  summary,
}: {
  email: string;
  name: string;
  onSignOut: () => Promise<unknown>;
  onViewChange: (view: WorkspaceView) => void;
  role: "member" | "operator";
  summary: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const go = (view: WorkspaceView) => {
    onViewChange(view);
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                className="aria-expanded:bg-muted"
                size="lg"
                tooltip={name}
              />
            }
          >
            <Avatar>
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-muted-foreground text-xs">
                {summary}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="grid gap-1">
                  <span className="font-medium">{name}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {email}
                  </span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => go("settings")}>
                <Settings /> Settings
              </DropdownMenuItem>
              {role === "operator" ? (
                <DropdownMenuItem onClick={() => go("operator")}>
                  <ShieldCheck /> Operator tools
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void onSignOut()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function WorkspaceHeader({
  activeView,
  toolbar,
}: {
  activeView: WorkspaceView;
  toolbar?: ReactNode;
}) {
  const navigate = useNavigate();
  const title = {
    automation: "Automation",
    campaigns: "Campaigns",
    countries: "Markets",
    documents: "Documents",
    jobs: "Jobs",
    messageStyle: "Writing style",
    messages: "Messages",
    operator: "Operator tools",
    preferences: "Preferences",
    profile: "Profile",
    settings: "Settings",
    testLab: "Test Lab",
  }[activeView];
  return (
    <header className="min-w-0 shrink-0 border-b bg-background">
      <div className="flex h-14 min-w-0 items-center gap-3 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          orientation="vertical"
        />
        <h1 className="shrink-0 font-semibold text-sm">{title}</h1>
        {toolbar ? (
          <div className="ml-auto hidden min-w-0 flex-1 lg:flex">{toolbar}</div>
        ) : (
          <span className="ml-auto" />
        )}
        <Button
          aria-label="Messages"
          onClick={() => void navigate({ to: workspacePaths.messages })}
          size="icon-sm"
          variant={activeView === "messages" ? "secondary" : "ghost"}
        >
          <MessagesSquare />
        </Button>
        <ModeToggle />
      </div>
      {toolbar ? (
        <div className="border-t px-4 py-2 lg:hidden">{toolbar}</div>
      ) : null}
    </header>
  );
}
