import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCurrentUser } from "@/features/auth/auth-gate";
import { OperatorView } from "@/features/operator/view";
import { WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/operator/")({
  component: OperatorRoute,
});

function OperatorRoute() {
  const user = useCurrentUser();
  if (user.role !== "operator") {
    return <Navigate replace to="/app/jobs" />;
  }
  return (
    <WorkspacePage>
      <OperatorView request={apiRequest} />
    </WorkspacePage>
  );
}
