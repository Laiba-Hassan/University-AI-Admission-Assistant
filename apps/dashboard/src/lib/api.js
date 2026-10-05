import { API_URL } from "./config";
import { getAccessToken } from "./session";
export async function apiFetch(path, init = {}) {
  const token = await getAccessToken();
  const headers = {
    ...init.headers
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });
}
export async function apiJson(path, init) {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}`);
  return res.status === 204 ? undefined : res.json();
}