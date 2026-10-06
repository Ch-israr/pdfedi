"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi, tokenStore, type User } from "@/lib/api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!tokenStore.getAccess()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me);
    } catch {
      setUser(null);
      tokenStore.clear();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    tokenStore.set(res.access_token, res.refresh_token);
    // Fetch full user profile (login returns only tokens + user_id)
    const me = await authApi.me();
    setUser(me);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    await authApi.register(email, password, name);
    // Registration requires email verification; do not auto-login.
    // User must verify email then sign in.
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore — clear locally regardless
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const isAdmin = useMemo(
    () => !!user?.roles?.some((r) => ["super_admin", "admin", "support_viewer", "subscription_manager", "operations_manager"].includes(r)),
    [user]
  );

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refreshUser, isAdmin }),
    [user, loading, login, register, logout, refreshUser, isAdmin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
