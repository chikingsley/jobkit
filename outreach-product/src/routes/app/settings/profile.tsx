import { createFileRoute } from "@tanstack/react-router";
import { ProfileView } from "@/features/profile/view";
import { useWorkspaceContext } from "@/features/workspace/context";
import { ViewLoading, WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/profile")({
  component: ProfileRoute,
});

function ProfileRoute() {
  const { profile, setProfile } = useWorkspaceContext();
  return (
    <WorkspacePage>
      {profile ? (
        <ProfileView
          onSaved={setProfile}
          profile={profile}
          request={apiRequest}
        />
      ) : (
        <ViewLoading />
      )}
    </WorkspacePage>
  );
}
