"use client";

import { useEffect } from "react";

/** Shared modal shell (Enrollium_Design_Documentation.pdf, section 05: "Modal / backdrop open" is an instant
 * conditional render, never a CSS fade/scale-in). Every profile-menu destination (Account settings,
 * Notifications, Help & documentation) and the log-out confirm are this same shell. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
  dismissible = true
}) {
  useEffect(() => {
    if (!dismissible) return;
    const onKey = e => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dismissible]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={dismissible ? onClose : undefined}>
      <div className="card flex max-h-[85vh] w-full flex-col overflow-hidden" style={{
      maxWidth: width
    }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-heading text-lg font-semibold text-ink">{title}</h2>
          {dismissible && <button onClick={onClose} aria-label="Close" className="text-ink-2 hover:text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>;
}

/** The toggle switch component (design doc 04): two fixed states, swapped instantly -- no slide transition. */
export function ToggleSwitch({
  checked,
  onChange,
  disabled
}) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60" style={{
    background: checked ? "var(--accent)" : "var(--line)"
  }}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" style={{
      left: checked ? 22 : 2
    }} />
    </button>;
}