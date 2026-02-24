export function formatAIText(input: string): string {
  return String(input || "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\t/g, "  ")
    .trim();
}

export function formatAIStreamChunk(input: string): string {
  return String(input || "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");
}

export function formatItalicReferences(references: { title: string; url?: string }[]): string {
  if (!references.length) return "";
  const uniq: { title: string; url?: string }[] = [];
  const seen = new Set<string>();
  for (const r of references) {
    const key = `${r.title}::${r.url || ""}`;
    if (r.title && !seen.has(key)) {
      seen.add(key);
      uniq.push(r);
    }
  }
  const lines = uniq
    .map((r) => (r.url ? `- _${r.title} — ${r.url}_` : `- _${r.title}_`))
    .join("\n");
  return `\n\n_Références utilisées:_\n${lines}`;
}
