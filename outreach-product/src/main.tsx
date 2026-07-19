import { ThemeProvider } from "next-themes";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthGate } from "./features/auth/auth-gate";
import "./styles.css";
import "streamdown/styles.css";

const AuthenticatedApp = lazy(async () => ({
  default: (await import("@/authenticated-app")).AuthenticatedApp,
}));

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("JobKit root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        storageKey="jobkit-theme"
      >
        <TooltipProvider>
          <AuthGate>
            <Suspense
              fallback={
                <main className="grid min-h-svh place-items-center text-muted-foreground text-sm">
                  Loading your workspace…
                </main>
              }
            >
              <AuthenticatedApp />
            </Suspense>
          </AuthGate>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
