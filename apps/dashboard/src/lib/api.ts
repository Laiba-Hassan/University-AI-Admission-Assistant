import { API_URL } from "./config";
import { getAccessToken } from "./session";

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}
