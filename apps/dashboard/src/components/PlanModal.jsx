"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { apiFetch } from "@/lib/api";

const PLANS = [{
  id: "starter",
  name: "Starter",
  tagline: "Web widget only",
  price: "$49",
  features: ["AI admissions assistant on your website", "Unlimited knowledge base content", "Leads & conversations dashboard"]
}, {
  id: "growth",
  name: "Growth",
  tagline: "Web widget + WhatsApp",
  price: "$99",
  features: ["Everything in Starter", "WhatsApp Business connection", "Two-way WhatsApp staff replies"]
}];

/** Plan selection + real card capture, used both by Onboarding's "Go live" and the profile menu's "Update plan".
 * Two steps: pick a plan, then a Stripe PaymentElement confirms a SetupIntent -- the card itself is typed into
 * Stripe's own hosted iframe and never reaches this app's server; billing.ts only ever stores what Stripe's API
 * hands back afterward (brand/last4/expiry), never the PAN or CVV. `required` hides the close button so the
 * admin can't dismiss their way back into a dead widget -- `reason` picks the right copy for why ("demo" =
 * trial ran out, "payment" = the card on file is failing and the grace period is up). Picking ANY plan while a
 * payment is failing re-attaches the fresh card to the existing subscription and retries it immediately
 * (billing.ts's choosePlan) -- the admin doesn't need to know their current plan to fix a failing one. */
export function PlanModal({
  session,
  onClose,
  onSuccess,
  required = false,
  reason = "demo"
}) {
  const [plan, setPlan] = useState(null);
  const [setupIntent, setSetupIntent] = useState(undefined); // undefined = not fetched yet, null = stripe not configured
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!plan || setupIntent !== undefined) return;
    apiFetch("/api/v1/billing/setup-intent", {
      method: "POST"
    }).then(async res => {
      if (res.status === 503) {
        setSetupIntent(null);
        return;
      }
      if (!res.ok) throw new Error("setup_failed");
      setSetupIntent(await res.json());
    }).catch(() => setError("Couldn't start checkout -- try again in a moment."));
  }, [plan, setupIntent]);
  const stripePromise = useMemo(() => setupIntent?.publishable_key ? loadStripe(setupIntent.publishable_key) : null, [setupIntent?.publishable_key]);

  async function finish(selectedPlan) {
    session.setPlan?.(selectedPlan, null);
    await onSuccess?.(selectedPlan);
    onClose();
  }

  return <Modal title={plan ? `${PLANS.find(p => p.id === plan).name} plan` : "Choose a plan"} onClose={onClose} dismissible={!required} width={plan ? 460 : 640}>
      {required && <p className="mb-4 rounded-lg px-3 py-2 text-xs font-semibold" style={{
      background: "var(--chip-rejected-bg)",
      color: "var(--chip-rejected-fg)"
    }}>{reason === "payment" ? "Your card on file is failing and the grace period is up. Update it to keep your assistant answering students." : "Your demo has ended. Choose a plan to keep your assistant answering students."}</p>}

      {!plan && <div className="grid gap-4 sm:grid-cols-2">
          {PLANS.map(p => <button key={p.id} onClick={() => setPlan(p.id)} className="flex h-full flex-col items-start rounded-xl border border-line p-5 text-left hover:border-accent">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{p.tagline}</div>
              <div className="mt-1 font-heading text-xl font-semibold text-ink">{p.name}</div>
              <div className="mt-2 text-2xl font-semibold text-ink">{p.price}<span className="text-sm font-medium text-ink-2">/mo</span></div>
              <ul className="mt-4 space-y-1.5 text-sm text-ink-2">
                {p.features.map(f => <li key={f} className="flex gap-2"><span className="text-accent">✓</span>{f}</li>)}
              </ul>
              {/* mt-auto instead of mt-4: Starter's feature list wraps to more lines than Growth's, so a fixed
                 margin left "Get Starter" and "Get Growth" sitting at different heights across the two cards.
                 Pushing this to the bottom of the flex column (both buttons now h-full, same grid row) keeps
                 them on the same line regardless of how each plan's feature text wraps. */}
              <span className="mt-auto w-full rounded-lg bg-accent px-4 py-2 text-center text-sm font-semibold text-white">Get {p.name}</span>
            </button>)}
        </div>}

      {plan && setupIntent === undefined && <p className="text-sm text-muted">Loading checkout…</p>}
      {plan && setupIntent === null && <div>
          <p className="text-sm text-ink-2">Billing isn&apos;t configured on this server yet -- reach out to us and we&apos;ll get {PLANS.find(p => p.id === plan).name} set up for you.</p>
          <button onClick={() => setPlan(null)} className="mt-3 text-xs font-semibold text-accent hover:underline">← Choose a different plan</button>
        </div>}
      {plan && setupIntent && stripePromise && <Elements stripe={stripePromise} options={{
      clientSecret: setupIntent.client_secret
    }}>
          <CardForm plan={plan} onBack={required ? null : () => setPlan(null)} onError={setError} onSuccess={finish} />
        </Elements>}
      {error && <p className="mt-3 text-xs" style={{
      color: "var(--chip-rejected-fg)"
    }}>{error}</p>}
    </Modal>;
}

function CardForm({
  plan,
  onBack,
  onError,
  onSuccess
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    onError(null);
    try {
      const {
        error,
        setupIntent
      } = await stripe.confirmSetup({
        elements,
        redirect: "if_required"
      });
      if (error) {
        onError(error.message ?? "Your card couldn't be confirmed.");
        return;
      }
      const res = await apiFetch("/api/v1/billing/choose-plan", {
        method: "POST",
        body: JSON.stringify({
          plan,
          payment_method_id: setupIntent.payment_method
        })
      });
      if (!res.ok) {
        onError("Your card was saved, but activating the plan failed -- try again.");
        return;
      }
      await onSuccess(plan);
    } finally {
      setBusy(false);
    }
  }
  return <form onSubmit={submit}>
      <PaymentElement />
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {busy ? "Confirming…" : "Confirm & go live"}
        </button>
        {onBack && <button type="button" onClick={onBack} className="text-xs font-semibold text-ink-2 hover:underline">← Choose a different plan</button>}
      </div>
    </form>;
}
