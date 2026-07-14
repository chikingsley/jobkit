import { useState } from "react";
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

type AuthMode = "sign-in" | "sign-up";

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(form: HTMLFormElement) {
    const values = new FormData(form);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    setBusy(true);
    setError("");
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({
              email,
              name: String(values.get("name") ?? "").trim(),
              password,
            })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Sign-in failed");
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Sign-in failed"
      );
    } finally {
      setBusy(false);
    }
  }

  const signingUp = mode === "sign-up";
  let submitLabel = "Sign in";
  if (busy) {
    submitLabel = "Working…";
  } else if (signingUp) {
    submitLabel = "Create account";
  }
  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 grid size-9 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground">
            J
          </div>
          <CardTitle>
            {signingUp ? "Create your workspace" : "Sign in to JobKit"}
          </CardTitle>
          <CardDescription>
            Your secure browser session stays signed in across normal
            development restarts.
          </CardDescription>
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
                minLength={12}
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
