/** Accept only same-origin relative paths ("/foo?x=1"); anything else -> "/". */
export function sanitizeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return "/";
  if (!raw.startsWith("/")) return "/";
  // "//host" and "/\host" are protocol-relative / browser-normalised to external hosts
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\\]/.test(raw)) return "/";
  return raw;
}
