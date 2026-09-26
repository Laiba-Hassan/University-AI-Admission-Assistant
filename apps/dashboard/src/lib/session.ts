"use client";
import { useEffect, useState } from "react";
import { API_URL } from "./config";
import { supabase } from "./supabase";

export interface StaffSession {
  status: "loading" | "signed-out" | "ready" | "unconfigured";
  email?: string;
  role?: "admin" | "editor" | "viewer";
  tenantId?: string;
  tenantName?: string;
  signOut: () => Promise<void>;
}

/** The bearer token for authenticated API calls, or null if signed out / not configured. */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** The dashboard's one source of truth for "who is signed in and which tenant do they belong to" -- a Supabase
 * session token exchanged for tenant/role via the existing GET /api/v1/me (resolveStaffTenant + requireRole). */
export function useStaffSession(): StaffSession {
  const [state, setState] = useState<Omit<StaffSession, "signOut">>({ status: supabase ? "loading" : "unconfigured" });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const email = data.session?.user.email;
      if (!token) { if (!cancelled) setState({ status: "signed-out" }); return; }
      try {
        const res = await fetch(`${API_URL}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) { if (!cancelled) setState({ status: "signed-out" }); return; }
        const me = (await res.json()) as { tenantId: string; role: "admin" | "editor" | "viewer"; tenantName?: string };
        if (!cancelled) setState({ status: "ready", email, role: me.role, tenantId: me.tenantId, tenantName: me.tenantName });
      } catch {
        if (!cancelled) setState({ status: "signed-out" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { ...state, signOut: async () => { await supabase?.auth.signOut(); window.location.href = "/sign-in"; } };
}
