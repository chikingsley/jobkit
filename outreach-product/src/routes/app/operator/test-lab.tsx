import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCurrentUser } from "@/features/auth/auth-gate";
import { TestLabView } from "@/features/test-lab/view";
import { testLabSearchSchema } from "@/features/workspace/search";
import { WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/operator/test-lab")({
  component: TestLabRoute,
  validateSearch: testLabSearchSchema,
});

function TestLabRoute() {
  const user = useCurrentUser();
  if (user.role !== "operator") {
    return <Navigate replace to="/app/jobs" />;
  }
  return (
    <WorkspacePage>
      <TestLabView request={apiRequest} />
    </WorkspacePage>
  );
}
