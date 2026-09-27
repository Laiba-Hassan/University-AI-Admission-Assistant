"use client";
import type { Alert } from "@/lib/alerts";

export function Toasts({ toasts, onDismiss }: { toasts: (Alert & { label: string })[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="card flex items-center gap-3 px-4 py-3 shadow-lg">
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
          <span className="text-sm text-ink">{t.label}</span>
          <button onClick={() => onDismiss(t.id)} className="ml-2 text-xs text-muted hover:text-ink">✕</button>
        </div>
      ))}
    </div>
  );
}
