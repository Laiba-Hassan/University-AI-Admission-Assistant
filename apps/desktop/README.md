# Enrollium Desktop

A thin Electron wrapper around the real staff dashboard (`apps/dashboard`) -- it owns no product logic of its
own. Everything (auth, data, notifications content) is the dashboard's own code, loaded from its real URL.

## What this adds over a browser tab

- **Tray icon** with "Open Enrollium" / "Start at login" / "Quit". Closing the window minimizes to tray instead
  of quitting, so the app stays reachable for notifications.
- **Start at login** (optional, off by default), toggled from the tray menu.
- **Desktop notifications for new leads/handoffs**: the dashboard's own existing alert poll
  (`apps/dashboard/src/lib/alerts.ts`) fires a standard `Notification(...)` call when a new one arrives -- no
  Electron-specific code in the dashboard for this, it's the same `Notification` API a real browser tab has.
  This app's main process just pre-grants notification permission for the dashboard's own origin so the staff
  member isn't prompted.
- **Auto-update** via `electron-updater`, configured to read releases from this repo's GitHub Releases (see
  "Publishing a release" below).

## Development

```bash
# In one terminal: the real dashboard it will load
pnpm dashboard:dev

# In another: this wrapper (defaults to http://localhost:3002)
pnpm --filter @uaa/desktop dev
```

Point it at a different dashboard (e.g. a staging deploy) with `ENROLLIUM_DASHBOARD_URL`:

```bash
ENROLLIUM_DASHBOARD_URL=https://staging.enrollium.ai pnpm --filter @uaa/desktop dev
```

## Building an installer

```bash
pnpm --filter @uaa/desktop build
```

Produces an NSIS installer under `apps/desktop/release/`. `--dir` (`pnpm --filter @uaa/desktop build:dir`)
builds an unpacked app for a quick smoke test without producing the installer.

## Code signing -- not done here, and needs a real decision from whoever owns this repo

`electron-builder.yml`/`package.json`'s `build.win` deliberately has no `certificateFile` /
`certificateSubjectName`. Signing a Windows installer needs a real code-signing certificate purchased from a CA
(or an EV cert + hardware token) -- that is a real-world purchase decision and identity-verification process I
cannot make or carry out. Until one is added, `pnpm --filter @uaa/desktop build` still produces a real, working
installer; Windows SmartScreen will show an "unknown publisher" warning the first time a user runs it, which is
expected and goes away once a certificate is added (`win.certificateFile` + `CSC_KEY_PASSWORD` env var, per
electron-builder's own docs, is where it plugs in).

## Publishing a release (for auto-update to actually find something)

`electron-builder`'s `--publish` flag (or `pnpm --filter @uaa/desktop build -- --publish always`) uploads the
installer + `latest.yml` to a GitHub Release for this repo, which is exactly what `autoUpdater` in `src/main.ts`
checks against. This needs a `GH_TOKEN` env var with `repo` scope; until a release exists there, the auto-update
check in `main.ts` simply finds nothing and logs that, rather than failing the app.

## Download page

See [`apps/dashboard/src/app/download/page.tsx`](../dashboard/src/app/download/page.tsx) (`/download`, no auth
needed) -- links to this repo's GitHub Releases page and gives plain install instructions, including the
SmartScreen "Run anyway" step for the not-yet-signed installer.
