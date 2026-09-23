import { TENANT } from "./content";

// Matches devWidgetKey() in apps/api/src/seed/seed.ts exactly -- the dev widget key pnpm seed writes for this
// tenant. A real deployment would set NEXT_PUBLIC_WIDGET_KEY explicitly to that tenant's real widget key instead.
export const WIDGET_KEY = process.env.NEXT_PUBLIC_WIDGET_KEY ?? `wk_dev_${TENANT.replace(/-/g, "_")}`;
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export const WIDGET_URL = process.env.NEXT_PUBLIC_WIDGET_URL ?? "http://localhost:5174";
