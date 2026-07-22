import { createFileRoute } from "@tanstack/react-router";
import { DocumentsView } from "@/features/documents/view";
import { useWorkspaceContext } from "@/features/workspace/context";
import { WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/documents")({
  component: DocumentsRoute,
});

function DocumentsRoute() {
  const { documents, loadDocuments } = useWorkspaceContext();
  return (
    <WorkspacePage>
      <DocumentsView
        documents={documents}
        onChanged={loadDocuments}
        request={apiRequest}
      />
    </WorkspacePage>
  );
}
