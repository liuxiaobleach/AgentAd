// Publisher-scoped fetch helper. Uses a separate localStorage key so the
// publisher session doesn't collide with the advertiser session — both UIs
// can coexist in the same browser tab.
export const PUBLISHER_TOKEN_KEY = "zkdsp_publisher_token";
export const PUBLISHER_USER_KEY = "zkdsp_publisher_user";

export function publisherApiFetch(url: string, options?: RequestInit): Promise<Response> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem(PUBLISHER_TOKEN_KEY) : null;

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
}

export function getPublisherToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PUBLISHER_TOKEN_KEY);
}

export function setPublisherSession(token: string, user: PublisherUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PUBLISHER_TOKEN_KEY, token);
  localStorage.setItem(PUBLISHER_USER_KEY, JSON.stringify(user));
}

export function clearPublisherSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PUBLISHER_TOKEN_KEY);
  localStorage.removeItem(PUBLISHER_USER_KEY);
}

export function getPublisherUser(): PublisherUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(PUBLISHER_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PublisherUser;
  } catch {
    return null;
  }
}

export type PublisherUser = {
  id: string;
  name: string;
  email: string;
  walletAddress: string | null;
  role: string;
};
