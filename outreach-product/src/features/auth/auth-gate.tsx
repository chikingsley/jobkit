import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { AuthPage } from "@/features/auth/auth-page";
import {
  localDevelopmentAuthEnabled,
  localDevelopmentUser,
} from "@/features/auth/local-development";
import { authClient } from "@/lib/auth-client";

export interface CurrentUser {
  email: string;
  id: string;
  name: string;
  role: "member" | "operator";
}

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
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!session.data) {
      setUser(null);
      return;
    }
    let active = true;
    void fetch("/api/me", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Account access could not be loaded");
        }
        return (await response.json()) as { user: CurrentUser };
      })
      .then((result) => {
        if (active) {
          setUser(result.user);
        }
      })
      .catch(() => {
        if (active && session.data) {
          setUser({
            email: session.data.user.email,
            id: session.data.user.id,
            name: session.data.user.name,
            role: "member",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [session.data]);

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
