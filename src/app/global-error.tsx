"use client"; // Error boundaries must be Client Components

// Replaces the root layout: own <html>/<body>, no Tailwind or layout fonts.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8f6f1", color: "#0f172a" }}>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "96px 24px", textAlign: "center" }}>
          <title>Something went wrong · JobRadar</title>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Service temporarily unavailable</h1>
          <p style={{ color: "#475569", fontSize: 15, lineHeight: 1.5, margin: "0 0 20px" }}>
            JobRadar hit an unexpected problem. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ minHeight: 44, padding: "0 20px", fontSize: 15, fontWeight: 600, border: 0, borderRadius: 8, background: "#0f172a", color: "#fff", cursor: "pointer" }}
          >
            Retry
          </button>
          {error.digest && <p style={{ color: "#64748b", fontSize: 12, marginTop: 16 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
