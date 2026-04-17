"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface User {
  id: string;
  name: string;
  email: string;
  walletAddress: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
  refreshUser: async () => {},
  loading: true,
});

function persistUser(user: User | null) {
  if (typeof window === "undefined") return;
  if (user) {
    localStorage.setItem("zkdsp_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("zkdsp_user");
  }
}

function persistToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    localStorage.setItem("zkdsp_token", token);
  } else {
    localStorage.removeItem("zkdsp_token");
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshUser(nextToken?: string | null) {
    const authToken =
      nextToken !== undefined
        ? nextToken
        : typeof window !== "undefined"
        ? localStorage.getItem("zkdsp_token")
        : token;

    if (!authToken) {
      setUser(null);
      persistUser(null);
      return;
    }

    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      if (res.status === 401) {
        setToken(null);
        setUser(null);
        persistToken(null);
        persistUser(null);
      }
      const err = await res.json().catch(() => ({ error: "Failed to refresh user" }));
      throw new Error(err.error || "Failed to refresh user");
    }

    const data = await res.json();
    setUser(data);
    persistUser(data);
  }

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      const savedToken = localStorage.getItem("zkdsp_token");
      const savedUser = localStorage.getItem("zkdsp_user");

      if (savedToken) {
        setToken(savedToken);
        if (savedUser) {
          try {
            setUser(JSON.parse(savedUser));
          } catch {
            localStorage.removeItem("zkdsp_user");
          }
        }
        try {
          await refreshUser(savedToken);
        } catch {
          // Ignore bootstrap refresh failures; unauthorized sessions are cleared in refreshUser.
        }
      }

      if (active) {
        setLoading(false);
      }
    };

    initialize();
    return () => {
      active = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Login failed");
    }
    const data = await res.json();
    setToken(data.token);
    setUser(data.advertiser);
    persistToken(data.token);
    persistUser(data.advertiser);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    persistToken(null);
    persistUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function authHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
