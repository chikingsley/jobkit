import { Link } from "@tanstack/react-router";
import type { PropsWithChildren, ReactNode } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { localDevelopmentAuthEnabled } from "@/features/auth/local-development";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function PublicSiteShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-5 px-4 sm:px-6">
          <Link className="font-semibold tracking-tight" to="/">
            JobKit
          </Link>
          <nav
            aria-label="Primary"
            className="flex min-w-0 items-center gap-4 text-sm"
          >
            <Link activeProps={{ className: "text-foreground" }} to="/jobs">
              Jobs
            </Link>
            <Link
              activeProps={{ className: "text-foreground" }}
              className="hidden text-muted-foreground hover:text-foreground sm:inline"
              to="/methodology"
            >
              Methodology
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <SiteAccountActions />
            <ModeToggle />
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-muted-foreground text-xs sm:px-6">
          <span>JobKit</span>
          <Link className="hover:text-foreground" to="/methodology">
            Methodology
          </Link>
          <Link className="hover:text-foreground" to="/corrections">
            Corrections
          </Link>
          <Link className="hover:text-foreground" to="/privacy">
            Privacy
          </Link>
          <Link className="hover:text-foreground" to="/terms">
            Terms
          </Link>
        </div>
      </footer>
    </div>
  );
}

function SiteAccountActions() {
  const session = authClient.useSession();
  const signedIn = localDevelopmentAuthEnabled || Boolean(session.data);
  if (signedIn) {
    return (
      <Link
        className="inline-flex min-h-9 items-center rounded-lg px-3 font-medium text-sm hover:bg-muted"
        to="/app/jobs"
      >
        Workspace
      </Link>
    );
  }
  return (
    <>
      <Link
        className="inline-flex min-h-9 items-center rounded-lg px-3 font-medium text-sm hover:bg-muted"
        to="/app/jobs"
      >
        Log in
      </Link>
      <Link
        className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 font-medium text-primary-foreground text-sm hover:bg-primary/90"
        search={{ signup: true }}
        to="/app/jobs"
      >
        Sign up
      </Link>
    </>
  );
}

export function PublicPageMain({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <main
      className={cn(
        "mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10",
        className
      )}
    >
      {children}
    </main>
  );
}

export function PublicPageHeading({
  description,
  title,
}: {
  description?: ReactNode;
  title: string;
}) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
        {title}
      </h1>
      {description ? (
        <div className="mt-2 text-muted-foreground text-sm leading-6 sm:text-base">
          {description}
        </div>
      ) : null}
    </div>
  );
}
