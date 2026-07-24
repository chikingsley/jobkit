import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { apiJson } from "@/lib/api";
import type { StoredDocument } from "@/profile-types";

export type DocumentScope = "all" | "own";

export const documentsKeys = {
  all: ["documents"] as const,
  scope: (scope: DocumentScope) => ["documents", scope] as const,
};

export function useDocuments(scope: DocumentScope = "own") {
  return useQuery({
    queryFn: async () => {
      const path =
        scope === "all" ? "/api/documents?scope=all" : "/api/documents";
      const payload = await apiJson<{ documents: StoredDocument[] }>(path);
      return payload.documents;
    },
    queryKey: documentsKeys.scope(scope),
  });
}

export function useInvalidateDocuments() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: documentsKeys.all });
  }, [queryClient]);
}
