"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { API_URL } from "./config";
import { supabase } from "./supabase";

const PlatformSessionContext = createContext(null);

/** Mirrors SessionProvider (lib/session.js), but resolves against GET /api/platform/me -- a Supabase user who
 * is a real, verified auth user but NOT a platform admin gets "forbidden", never silently treated as one. */
export function PlatformSessionProvider({ children }) {
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
      if (!token) {
        if (!cancelled) setState({
          status: "signed-out"
        });
        return;
      }
      try {
        const res = await fetch(`${API_URL}/api/platform/me`, {
          headers: {
            authorization: `Bearer ${token}`
          }
        });
        if (res.status === 403) {
          if (!cancelled) setState({
            status: "forbidden"
          });
          return;
        }
        if (!res.ok) {
          if (!cancelled) setState({
            status: "signed-out"
          });
          return;
        }
        const me = await res.json();
        if (!cancelled) setState({
          status: "ready",
          email: me.email
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
    signOut: async () => {
      await supabase?.auth.signOut();
      window.location.href = "/platform-sign-in";
    }
  };
  return <PlatformSessionContext.Provider value={value}>{children}</PlatformSessionContext.Provider>;
}

export function usePlatformSession() {
  const ctx = useContext(PlatformSessionContext);
  if (!ctx) throw new Error("usePlatformSession() must be used under <PlatformSessionProvider> (the platform layout)");
  return ctx;
}
