import { useQuery } from "@tanstack/react-query";

export interface CurrentUser {
  email: string;
  id: string;
  name: string;
  role: "member" | "operator";
}

export const authKeys = {
  me: (userId: string) => ["me", userId] as const,
};

export function useAccountAccess(userId: string | undefined) {
  return useQuery({
    enabled: Boolean(userId),
    queryFn: async () => {
      const response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) {
        throw new Error("Account access could not be loaded");
      }
      return (await response.json()) as { user: CurrentUser };
    },
    queryKey: authKeys.me(userId ?? ""),
    retry: false,
  });
}
