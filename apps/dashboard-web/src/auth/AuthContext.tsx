import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, type User } from "../api/client";

type AuthState = {
  user: User | null;
  csrfToken: string | null;
  loading: boolean;
  error: string | null;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    csrfToken: null,
    loading: true,
    error: null,
  });

  const setError = (error: unknown) => {
    if (error instanceof ApiError) {
      setState((prev) => ({ ...prev, error: error.message }));
      return;
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    setState((prev) => ({ ...prev, error: message }));
  };

  const bootstrap = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { user, token } = await api.bootstrapSession();
      setState({ user: user ?? null, csrfToken: token, loading: false, error: null });
    } catch (error) {
      setError(error);
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, error: null }));
    const { user } = await api.login(email, password);
    const token = await api.refreshCsrf();
    setState((prev) => ({ ...prev, user, csrfToken: token, error: null }));
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, error: null }));
    const { user } = await api.signup(email, password);
    const token = await api.refreshCsrf();
    setState((prev) => ({ ...prev, user, csrfToken: token, error: null }));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      // If logout fails (e.g. session already expired), still clear local state to force a fresh login.
      setError(error);
    } finally {
      setState((prev) => ({ ...prev, user: null, csrfToken: null }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.getMe();
      setState((prev) => ({ ...prev, user, error: null }));
    } catch (error) {
      setError(error);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      signup,
      logout,
      refresh,
    }),
    [state, login, signup, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
