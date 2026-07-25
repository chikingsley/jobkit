import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import streamdownStyles from "streamdown/styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import appStyles from "@/styles.css?url";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootComponent,
  head: () => ({
    links: [
      { href: appStyles, rel: "stylesheet" },
      { href: streamdownStyles, rel: "stylesheet" },
    ],
    meta: [
      { charSet: "utf-8" },
      {
        content: "width=device-width, initial-scale=1.0",
        name: "viewport",
      },
      { content: "#f7f5ef", name: "theme-color" },
      { title: "JobKit" },
    ],
  }),
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  return (
    <RootDocument>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        storageKey="jobkit-theme"
      >
        <TooltipProvider>
          <Outlet />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundPage() {
  return (
    <main className="grid min-h-svh place-items-center px-6 text-center">
      <div className="grid gap-2">
        <h1 className="font-semibold text-2xl">Page unavailable</h1>
        <p className="text-muted-foreground text-sm">
          JobKit could not find a published page at this address.
        </p>
      </div>
    </main>
  );
}
