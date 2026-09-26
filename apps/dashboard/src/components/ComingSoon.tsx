export function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="font-heading text-[26px] font-semibold text-ink">{title}</h1>
      <p className="mt-4 text-sm text-ink-2">This page is a placeholder for the next build slice -- not wired up yet.</p>
    </div>
  );
}
