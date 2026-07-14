import { createContext, type PropsWithChildren, useContext } from "react";
import { AuthPage } from "@/features/auth/auth-page";
import { authClient } from "@/lib/auth-client";

interface CurrentUser {
  email: string;
  id: string;
  name: string;
}

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function AuthGate({ children }: PropsWithChildren) {
  const session = authClient.useSession();
  if (session.isPending) {
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
    <CurrentUserContext.Provider value={session.data.user}>
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
