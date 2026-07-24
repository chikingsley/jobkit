import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export type AuthMode = "sign-in" | "sign-up";

export function authModeFromSearch(signup: boolean | undefined): AuthMode {
  return signup ? "sign-up" : "sign-in";
}

export function AuthPage() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>(() =>
    authModeFromSearch(search.signup)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMode(authModeFromSearch(search.signup));
  }, [search.signup]);

  async function submit(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      const result = await submitCredentials(mode, new FormData(form));
      if (result.error) {
        setError(result.error.message ?? fallbackError(mode));
      } else if (search.signup !== undefined) {
        void navigate({
          replace: true,
          search: (current) => ({ ...current, signup: undefined }),
          to: ".",
        });
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : fallbackError(mode)
      );
    } finally {
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        callbackURL: `${window.location.pathname}${window.location.search}`,
        provider: "google",
      });
      if (result.error) {
        setError(result.error.message ?? "Google sign-in is unavailable");
      }
    } catch (googleError) {
      setError(
        googleError instanceof Error
          ? googleError.message
          : "Google sign-in is unavailable"
      );
    } finally {
      setBusy(false);
    }
  }

  const signingUp = mode === "sign-up";
  let submitLabel = "Log in";
  if (busy) {
    submitLabel = "Working…";
  } else if (signingUp) {
    submitLabel = "Create account";
  }
  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Link
            aria-label="Back to the JobKit site"
            className="mb-2 grid size-9 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground"
            to="/"
          >
            J
          </Link>
          <CardTitle>
            {signingUp ? "Create your JobKit account" : "Log in to JobKit"}
          </CardTitle>
          <CardDescription>
            {signingUp
              ? "One profile for every application you send."
              : "Welcome back. Continue your applications."}
          </CardDescription>
          {search.publicJob ? (
            <p className="text-muted-foreground text-xs">
              Your selected job will be waiting after you continue.
            </p>
          ) : null}
        </CardHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <CardContent className="grid gap-4">
            {signingUp ? (
              <div className="grid gap-2">
                <Label htmlFor="auth-name">Name</Label>
                <Input
                  autoComplete="name"
                  id="auth-name"
                  name="name"
                  required
                />
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                autoComplete="email"
                id="auth-email"
                name="email"
                required
                type="email"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                autoComplete={signingUp ? "new-password" : "current-password"}
                id="auth-password"
                minLength={signingUp ? 12 : undefined}
                name="password"
                required
                type="password"
              />
              {signingUp ? (
                <p className="text-muted-foreground text-xs">
                  Use at least 12 characters.
                </p>
              ) : null}
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="mt-4 grid gap-2">
            <Button className="w-full" disabled={busy} size="lg" type="submit">
              {submitLabel}
            </Button>
            <div className="flex items-center gap-3 text-muted-foreground text-xs">
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              or
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => void continueWithGoogle()}
              type="button"
              variant="outline"
            >
              <GoogleMark />
              Continue with Google
            </Button>
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => {
                setMode(signingUp ? "sign-in" : "sign-up");
                setError("");
              }}
              type="button"
              variant="ghost"
            >
              {signingUp ? "I already have an account" : "Create an account"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}

function submitCredentials(mode: AuthMode, values: FormData) {
  const email = String(values.get("email") ?? "").trim();
  const password = String(values.get("password") ?? "");
  if (mode === "sign-up") {
    return authClient.signUp.email({
      email,
      name: String(values.get("name") ?? "").trim(),
      password,
    });
  }
  return authClient.signIn.email({ email, password });
}

function fallbackError(mode: AuthMode) {
  return mode === "sign-up"
    ? "Your account could not be created"
    : "You could not be logged in";
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
