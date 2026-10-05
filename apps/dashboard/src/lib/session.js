"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { API_URL } from "./config";
import { supabase } from "./supabase";
/** The bearer token for authenticated API calls, or null if signed out / not configured. */
export async function getAccessToken() {
  if (!supabase) return null;
  const {
    data
  } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

const SessionContext = createContext(null);

/** The dashboard's one source of truth for "who is signed in and which tenant do they belong to" -- a Supabase
 * session token exchanged for tenant/role via the existing GET /api/v1/me (resolveStaffTenant + requireRole).
 * Resolved ONCE here and shared via context -- every call site used to run this same fetch independently
 * (layout, Sidebar, and each page that reads session.role), tripling /api/v1/me round trips per navigation. */
export function SessionProvider({ children }) {
  const [state, setState] = useState({
    status: supabase ? "loading" : "unconfigured"
  });
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const {
        data
      } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const email = data.session?.user.email;
      if (!token) {
        if (!cancelled) setState({
          status: "signed-out"
        });
        return;
      }
      try {
        const res = await fetch(`${API_URL}/api/v1/me`, {
          headers: {
            authorization: `Bearer ${token}`
          }
        });
        if (!res.ok) {
          if (!cancelled) setState({
            status: "signed-out"
          });
          return;
        }
        const me = await res.json();
        if (!cancelled) setState({
          status: "ready",
          email,
          role: me.role,
          tenantId: me.tenantId,
          tenantName: me.tenantName,
          planLabel: me.planLabel,
          demoExpiresAt: me.demoExpiresAt ?? null,
          paymentFailedAt: me.paymentFailedAt ?? null,
          tenantLogo: me.tenantLogo ?? null,
          fullName: me.fullName ?? null,
          avatarUrl: me.avatarUrl ?? null,
          passwordChangeStatus: me.passwordChangeStatus
        });
      } catch {
        if (!cancelled) setState({
          status: "signed-out"
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const value = {
    ...state,
    setAvatarUrl: avatarUrl => setState(s => ({
      ...s,
      avatarUrl
    })),
    setFullName: fullName => setState(s => ({
      ...s,
      fullName
    })),
    setTenantLogo: tenantLogo => setState(s => ({
      ...s,
      tenantLogo
    })),
    setPasswordChangeStatus: passwordChangeStatus => setState(s => ({
      ...s,
      passwordChangeStatus
    })),
    // Called once Update Plan / Go Live actually succeeds, so the sidebar label and the Overview countdown
    // banner reflect the new plan immediately instead of waiting for a full reload. Clears paymentFailedAt too --
    // a successful choosePlan() call always means a payment just succeeded (billing.ts sets it to NULL), so a
    // grace-period banner the admin was staring at must disappear in the same moment, not just the demo one.
    setPlan: (planLabel, demoExpiresAt = null) => setState(s => ({
      ...s,
      planLabel,
      demoExpiresAt,
      paymentFailedAt: null
    })),
    signOut: async () => {
      await supabase?.auth.signOut();
      window.location.href = "/sign-in";
    }
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useStaffSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useStaffSession() must be used under <SessionProvider> (the (dashboard) layout)");
  return ctx;
}
