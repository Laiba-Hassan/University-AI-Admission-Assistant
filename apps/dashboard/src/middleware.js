import { NextResponse } from "next/server";

// Lets the exact same dashboard codebase be deployed a second time as a dedicated "super admin" link: when
// PLATFORM_ONLY=true is set (only on that second Vercel project, never the staff-facing one), visiting the
// root just sends you straight to the platform-admin sign-in instead of the staff one.
export function middleware(request) {
  if (process.env.PLATFORM_ONLY === "true" && request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/platform-sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/" };
