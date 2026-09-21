// Splits a knowledge document (Markdown with front matter) into retrieval chunks.
// Each chunk is prefixed with the document title and section heading so it stands alone when retrieved.

export interface ParsedDoc { title: string; sourceType: string; approved: boolean; body: string }

export function parseDocument(raw: string): ParsedDoc {
  const m = raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("document is missing front matter");
  const meta = Object.fromEntries(m[1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
  return { title: meta.title!, sourceType: meta.source_type!, approved: meta.approved === "true", body: m[2]! };
}

const MIN = 350;   // sections shorter than this are merged with the next one
const MAX = 1400;  // chunks longer than this are split on paragraph boundaries

export function chunkDocument(doc: ParsedDoc): { content: string; heading: string }[] {
  const sections: { heading: string; text: string }[] = [];
  let heading = doc.title;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ heading, text });
    buf = [];
  };
  for (const line of doc.body.split("\n")) {
    const h = line.match(/^#{1,3}\s+(.*)$/);
    if (h) { flush(); heading = h[1]!.trim(); } else buf.push(line);
  }
  flush();

  const merged: { heading: string; text: string }[] = [];
  for (const s of sections) {
    const last = merged[merged.length - 1];
    if (last && last.text.length < MIN) { last.text += `\n\n${s.text}`; last.heading = `${last.heading} / ${s.heading}`; }
    else merged.push({ ...s });
  }

  const out: { content: string; heading: string }[] = [];
  for (const s of merged) {
    let piece = "";
    const emit = () => { if (piece.trim()) out.push({ heading: s.heading, content: `${doc.title} — ${s.heading}\n${piece.trim()}` }); piece = ""; };
    for (const para of s.text.split(/\n{2,}/)) {
      if (piece && piece.length + para.length > MAX) emit();
      piece += `${para}\n\n`;
    }
    emit();
  }
  return out;
}
