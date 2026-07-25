import { createContext, type PropsWithChildren, useContext } from "react";
import { AuthPage } from "@/features/auth/auth-page";
import {
  localDevelopmentAuthEnabled,
  localDevelopmentUser,
} from "@/features/auth/local-development";
import { type CurrentUser, useAccountAccess } from "@/features/auth/queries";
import { authClient } from "@/lib/auth-client";

export type { CurrentUser } from "@/features/auth/queries";

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function AuthGate({ children }: PropsWithChildren) {
  if (localDevelopmentAuthEnabled) {
    return (
      <CurrentUserContext.Provider value={localDevelopmentUser}>
        {children}
      </CurrentUserContext.Provider>
    );
  }
  return <SessionAuthGate>{children}</SessionAuthGate>;
}

function SessionAuthGate({ children }: PropsWithChildren) {
  const session = authClient.useSession();
  const account = useAccountAccess(session.data?.user.id);
  const fallbackUser: CurrentUser | null =
    account.isError && session.data
      ? {
          email: session.data.user.email,
          id: session.data.user.id,
          name: session.data.user.name,
          role: "member",
        }
      : null;
  const user = session.data ? (account.data?.user ?? fallbackUser) : null;

  if (session.isPending || (session.data && !user)) {
    return (
      <main className="grid min-h-svh place-items-center text-muted-foreground text-sm">
        Loading JobKit…
      </main>
    );
  }
  if (!session.data) {
    return <AuthPage />;
  }
  return (
    <CurrentUserContext.Provider value={user}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext);
  if (!user) {
    throw new Error("useCurrentUser must be used inside AuthGate");
  }
  return user;
}
