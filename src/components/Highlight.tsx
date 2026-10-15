/** Wraps occurrences of any (lower-cased) keyword in <mark>. */
export function Highlight({ text, keywords }: { text: string; keywords: string[] }) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k));
  if (hits.length === 0) return <>{text}</>;
  // split on any keyword occurrence
  const re = new RegExp(
    `(${hits.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return (
    <>
      {text.split(re).map((part, i) =>
        hits.includes(part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-amber-line px-0.5 text-amber-ink">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
