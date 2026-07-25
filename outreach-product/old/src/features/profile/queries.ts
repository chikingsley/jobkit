import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { type Profile, ProfileSchema } from "@/features/profile/schema";
import { apiJson } from "@/lib/api";

export const profileKeys = {
  root: ["profile"] as const,
};

export function useProfile() {
  return useQuery({
    queryFn: async () => {
      const payload = await apiJson<{ profile: unknown }>("/api/profile");
      return ProfileSchema.parse(payload.profile);
    },
    queryKey: profileKeys.root,
  });
}

export function useSetProfile() {
  const queryClient = useQueryClient();
  return useCallback(
    (profile: Profile) => queryClient.setQueryData(profileKeys.root, profile),
    [queryClient]
  );
}
