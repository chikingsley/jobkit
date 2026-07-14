import {
  BriefcaseBusiness,
  ChevronsUpDown,
  Files,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { WorkspaceView } from "@/features/workspace/routes";

const navigation = [
  { icon: BriefcaseBusiness, id: "jobs", label: "Jobs" },
  { icon: UserRound, id: "profile", label: "Profile" },
  { icon: SlidersHorizontal, id: "preferences", label: "Preferences" },
  { icon: Files, id: "documents", label: "Documents" },
] as const;

export function ViewLoading() {
  return (
    <div className="grid min-h-64 place-items-center text-muted-foreground text-sm">
      Loading workspace…
    </div>
  );
}

export function WorkspaceSidebar({
  activeView,
  applied,
  email,
  name,
  onViewChange,
  totalJobs,
}: {
  activeView: WorkspaceView;
  applied: number;
  email: string;
  name: string;
  onViewChange: (view: WorkspaceView) => void;
  totalJobs: number;
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
          onViewChange={onViewChange}
          summary={`${applied} of ${totalJobs} applications sent`}
        />
      </SidebarFooter>
    </Sidebar>
  );
}

function NavUser({
  email,
  name,
  onViewChange,
  summary,
}: {
  email: string;
  name: string;
  onViewChange: (view: WorkspaceView) => void;
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
              <DropdownMenuItem onClick={() => go("profile")}>
                <UserRound /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => go("preferences")}>
                <SlidersHorizontal /> Preferences
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => go("documents")}>
                <Files /> Documents
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function WorkspaceHeader({ activeView }: { activeView: WorkspaceView }) {
  const title = {
    documents: "Documents",
    jobs: "Job review",
    preferences: "Preferences",
    profile: "Profile",
  }[activeView];
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator
        className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        orientation="vertical"
      />
      <h1 className="font-semibold text-sm">{title}</h1>
      {activeView === "jobs" ? (
        <span className="ml-auto hidden text-muted-foreground text-xs sm:block">
          Review the facts, edit the message, then approve and send
        </span>
      ) : (
        <span className="ml-auto" />
      )}
      <ModeToggle />
    </header>
  );
}
