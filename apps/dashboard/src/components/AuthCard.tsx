export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent font-heading text-lg font-semibold text-accent">
            E
          </span>
        </div>
        <h1 className="text-center font-heading text-[26px] font-semibold text-ink">{title}</h1>
        <p className="mt-1.5 text-center text-sm text-ink-2">{subtitle}</p>
        <div className="mt-7">{children}</div>
      </div>
    </div>
  );
}

export function GoogleButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface py-2.5 text-sm font-semibold text-ink transition hover:bg-tint disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h11.9c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.9 6.5-9.6 6.5-16.7z" />
        <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41 15.4 46 24 46z" />
        <path fill="#FBBC05" d="M11.6 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.3C2.8 17 2 20.4 2 24s.8 7 2.3 10l7.3-5.8z" />
        <path fill="#EA4335" d="M24 10.2c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 3.6 30 1.5 24 1.5 15.4 1.5 7.9 6.5 4.3 13.8l7.3 5.7c1.7-5.2 6.6-9.3 12.4-9.3z" />
      </svg>
      Continue with Google
    </button>
  );
}

export function Divider({ text }: { text: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-line" />
      <span className="text-xs text-muted">{text}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Field({
  label, type = "text", value, onChange, placeholder, hint, action, required,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string;
  hint?: string; action?: React.ReactNode; required?: boolean;
}) {
  return (
    <label className="mb-4 block">
      <span className="flex items-baseline justify-between text-xs font-medium text-ink-2">
        {label}
        {action}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}
