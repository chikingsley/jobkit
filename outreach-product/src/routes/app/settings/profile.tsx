import { createFileRoute } from "@tanstack/react-router";
import { useProfile, useSetProfile } from "@/features/profile/queries";
import { ProfileView } from "@/features/profile/view";
import { ViewLoading, WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/profile")({
  component: ProfileRoute,
});

function ProfileRoute() {
  const profileQuery = useProfile();
  const setProfile = useSetProfile();
  return (
    <WorkspacePage>
      {profileQuery.data ? (
        <ProfileView
          onSaved={setProfile}
          profile={profileQuery.data}
          request={apiRequest}
        />
      ) : (
        <ViewLoading />
      )}
    </WorkspacePage>
  );
}
