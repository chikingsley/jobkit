import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthGate } from "./features/auth/auth-gate";
import { OnboardingGate } from "./features/onboarding/onboarding-gate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
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
            <OnboardingGate>
              <App />
            </OnboardingGate>
          </AuthGate>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
