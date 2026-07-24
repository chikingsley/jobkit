import { createFileRoute } from "@tanstack/react-router";
import {
  useDocuments,
  useInvalidateDocuments,
} from "@/features/documents/queries";
import { DocumentsView } from "@/features/documents/view";
import { WorkspacePage } from "@/features/workspace/shell";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/settings/documents")({
  component: DocumentsRoute,
});

function DocumentsRoute() {
  const documentsQuery = useDocuments();
  const invalidateDocuments = useInvalidateDocuments();
  return (
    <WorkspacePage>
      <DocumentsView
        documents={documentsQuery.data ?? []}
        onChanged={invalidateDocuments}
        request={apiRequest}
      />
    </WorkspacePage>
  );
}
