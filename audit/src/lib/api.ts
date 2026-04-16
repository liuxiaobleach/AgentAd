export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("zkdsp_token")
      : null;

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(url, { ...options, headers });
}
