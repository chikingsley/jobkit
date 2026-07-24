import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient();
  const router = createRouter({
    context: { queryClient },
    defaultPreload: "intent",
    routeTree,
    scrollRestoration: true,
  });
  setupRouterSsrQueryIntegration({ queryClient, router });
  return router;
}

declare module "@tanstack/router-core" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
