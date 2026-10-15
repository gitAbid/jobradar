export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4 text-sm leading-6 text-foreground">
      <p role="note" className="rounded-lg border border-border-strong bg-surface-raised px-4 py-2 font-semibold">
        Draft — review with a lawyer before launch
      </p>
      <h1 className="text-2xl font-bold tracking-tight">Terms of Service</h1>

      <h2 className="mt-2 text-lg font-bold">The service</h2>
      <p>JobRadar helps you discover and track job openings. Listings are aggregated from public job boards; we don’t employ, recruit for, or endorse any listed employer, and listings may be out of date or inaccurate. Always verify details with the employer.</p>

      <h2 className="mt-2 text-lg font-bold">Your account</h2>
      <p>You sign in with a third-party provider and are responsible for activity under your account and your API keys. Keep keys secret and revoke any that leak.</p>

      <h2 className="mt-2 text-lg font-bold">Acceptable use</h2>
      <p>Don’t abuse the service, attempt to bypass rate limits or access controls, or use the API to harm others or republish listings in violation of the original boards’ terms.</p>

      <h2 className="mt-2 text-lg font-bold">Availability and liability</h2>
      <p>The service is provided “as is” without warranties. We may change or discontinue it at any time and are not liable for lost opportunities or data to the extent permitted by law.</p>

      <h2 className="mt-2 text-lg font-bold">Ending your use</h2>
      <p>You can delete your account at any time from Settings. We may suspend accounts that violate these terms.</p>
    </article>
  );
}
