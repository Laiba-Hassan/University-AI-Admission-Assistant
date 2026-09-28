// The desktop app is a thin wrapper: it never talks to the API directly, it just loads the real staff
// dashboard's URL. ENROLLIUM_DASHBOARD_URL lets a packaged build point at production; unset, it falls back to
// the local dev server, so `pnpm --filter @uaa/desktop dev` works against `pnpm dashboard:dev` out of the box.
export const DASHBOARD_URL = process.env.ENROLLIUM_DASHBOARD_URL ?? "http://localhost:3002";
