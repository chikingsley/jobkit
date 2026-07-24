import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  type Preferences,
  PreferencesSchema,
} from "@/features/preferences/schema";
import { apiJson } from "@/lib/api";

export const preferencesKeys = {
  root: ["preferences"] as const,
};

export function usePreferences() {
  return useQuery({
    queryFn: async () => {
      const payload = await apiJson<{ preferences: unknown }>(
        "/api/preferences"
      );
      return PreferencesSchema.parse(payload.preferences);
    },
    queryKey: preferencesKeys.root,
  });
}

export function useSetPreferences() {
  const queryClient = useQueryClient();
  return useCallback(
    (preferences: Preferences) =>
      queryClient.setQueryData(preferencesKeys.root, preferences),
    [queryClient]
  );
}
