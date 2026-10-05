const MAP = {
  open: "chip-neutral",
  needs_human: "chip-draft",
  human: "chip-draft",
  closed: "chip-approved",
  approved: "chip-approved",
  draft: "chip-draft",
  rejected: "chip-rejected",
  missing: "chip-rejected"
};
const TEXT = {
  open: "Open",
  needs_human: "Needs human",
  human: "Human",
  closed: "Closed"
};
export function StatusChip({
  status
}) {
  return <span className={`chip ${MAP[status] ?? "chip-neutral"}`}>{TEXT[status] ?? status}</span>;
}