import Link from "next/link";

const REPO = "https://github.com/Laiba-Hassan/University-AI-Admission-Assistant";

// PRD 7: "download page with install instructions" for the Windows desktop app (apps/desktop). No auth needed --
// same top-level-outside-(dashboard) placement as /sign-in, since a staff member needs this before signing in.
export default function DownloadPage() {
  return (
    <div className="flex min-h-dvh justify-center bg-bg px-4 py-14">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent font-heading text-lg font-semibold text-accent">E</span>
        </div>
        <h1 className="text-center font-heading text-[26px] font-semibold text-ink">Enrollium for Windows</h1>
        <p className="mt-1.5 text-center text-sm text-ink-2">A desktop app for the staff dashboard -- tray icon, desktop notifications for new leads and handoffs, and one click back to it.</p>

        <div className="card mt-7 p-6 text-center">
          <a
            href={`${REPO}/releases/latest`}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
          >
            ↓ Download for Windows
          </a>
          <p className="mt-3 text-xs text-muted">
            Opens this project&apos;s <a href={`${REPO}/releases`} className="underline hover:no-underline">GitHub Releases</a> page -- grab the latest &quot;Enrollium Setup x.x.x.exe&quot;.
          </p>
        </div>

        <div className="card mt-5 p-6">
          <h2 className="font-heading text-base font-semibold text-ink">Installing</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-2">
            <li>Run the downloaded <code className="rounded bg-tint px-1 py-0.5 text-xs">Enrollium Setup x.x.x.exe</code>.</li>
            <li>
              Windows SmartScreen will likely show <em>&quot;Windows protected your PC&quot;</em> -- this build isn&apos;t
              code-signed yet. Click <strong>More info</strong>, then <strong>Run anyway</strong>.
            </li>
            <li>Choose an install location (or keep the default) and finish the installer.</li>
            <li>Sign in with your usual staff account -- it&apos;s the exact same dashboard, just in its own window.</li>
          </ol>
        </div>

        <div className="card mt-5 p-6">
          <h2 className="font-heading text-base font-semibold text-ink">What it adds over a browser tab</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
            <li>• A tray icon -- closing the window keeps it running in the background, reachable in one click.</li>
            <li>• Desktop notifications for new leads and handoffs while it&apos;s running.</li>
            <li>• Optional &quot;start at login&quot;, from the tray menu.</li>
            <li>• Automatic updates.</li>
          </ul>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Prefer the browser? <Link href="/sign-in" className="font-semibold text-accent hover:underline">Sign in at the regular dashboard</Link> -- it&apos;s the same app either way.
        </p>
        <p className="mt-2 text-center text-xs text-muted">
          <Link href="/legal/security" className="hover:underline">Security overview</Link> · <Link href="/legal/privacy" className="hover:underline">Privacy</Link> · <Link href="/legal/terms" className="hover:underline">Terms</Link>
        </p>
      </div>
    </div>
  );
}
