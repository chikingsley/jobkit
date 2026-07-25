import { useQuery } from "@tanstack/react-query";
import { InventoryStatusSchema } from "@/features/inventory/status";
import { apiJson } from "@/lib/api";

const ACTIVE_REFRESH_MS = 3000;

export const ACTIVE_INVENTORY_REFRESH_STATUSES = new Set([
  "queued",
  "claimed",
  "crawling",
  "publishing",
]);

export const inventoryKeys = {
  status: ["inventory", "status"] as const,
};

export function useInventoryStatus() {
  return useQuery({
    queryFn: async () =>
      InventoryStatusSchema.parse(
        await apiJson<unknown>("/api/inventory/status")
      ),
    queryKey: inventoryKeys.status,
    refetchInterval: (query) =>
      query.state.data?.refreshes.some((refresh) =>
        ACTIVE_INVENTORY_REFRESH_STATUSES.has(refresh.status)
      )
        ? ACTIVE_REFRESH_MS
        : false,
  });
}
