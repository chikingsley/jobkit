import { createFileRoute } from "@tanstack/react-router";
import { MessagesWorkspace } from "@/features/messages/workspace";
import { messagesSearchSchema } from "@/features/workspace/search";
import { apiRequest } from "@/lib/api";

export const Route = createFileRoute("/app/messages")({
  component: MessagesRoute,
  validateSearch: messagesSearchSchema,
});

function MessagesRoute() {
  return <MessagesWorkspace request={apiRequest} />;
}
