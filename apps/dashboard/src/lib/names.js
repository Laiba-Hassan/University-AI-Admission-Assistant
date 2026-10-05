// Shared "what name do we show for this staff member" logic -- a real full_name (set manually, or auto-filled
// from a Google sign-in's token) always wins; with neither, fall back to a name derived from the email's local
// part, the same way the sidebar always has, so the UI never shows a blank name.
export const nameFromEmail = email => email ? email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "";
export const displayName = ({ fullName, email }) => fullName?.trim() || nameFromEmail(email) || "Not signed in";
