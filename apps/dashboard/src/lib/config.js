export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
// Matches apps/web's own NEXT_PUBLIC_WIDGET_URL default -- where the loader script + widget iframe are served
// from, needed here only to show the tenant their exact embed snippet.
export const WIDGET_URL = process.env.NEXT_PUBLIC_WIDGET_URL ?? "http://localhost:5174";