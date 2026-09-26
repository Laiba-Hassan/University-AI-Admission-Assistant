const MAP: Record<string, string> = {
  open: "chip-neutral", needs_human: "chip-draft", human: "chip-draft", closed: "chip-approved",
  approved: "chip-approved", draft: "chip-draft", rejected: "chip-rejected", missing: "chip-rejected",
};
const TEXT: Record<string, string> = { open: "Open", needs_human: "Needs human", human: "Human", closed: "Closed" };

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${MAP[status] ?? "chip-neutral"}`}>{TEXT[status] ?? status}</span>;
}
