import "server-only";

import { API_BASE_URL } from "@/lib/runtime";
import { getAppSession } from "@/lib/session";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await getAppSession({ requireAuth: true });
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");

  if (session.mode === "demo") {
    headers.set("x-demo-user-email", session.email);
  } else {
    headers.set("x-external-auth-user-id", session.userId);
    headers.set("x-user-email", session.email);
  }

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}
