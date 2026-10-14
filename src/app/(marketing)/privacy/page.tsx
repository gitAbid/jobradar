export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4 text-sm leading-6 text-foreground">
      <p role="note" className="rounded-lg border border-border-strong bg-surface-raised px-4 py-2 font-semibold">
        Draft — review with a lawyer before launch
      </p>
      <h1 className="text-2xl font-bold tracking-tight">Privacy Policy</h1>

      <h2 className="mt-2 text-lg font-bold">What we store</h2>
      <ul className="list-disc pl-5">
        <li>Your profile from the sign-in provider (Google or GitHub): email address, name, and profile image.</li>
        <li>The state you create: saved, applied and hidden listings, tags, followed companies, pinned countries, and your settings.</li>
        <li>API keys you create. Only a hash and a short prefix are stored; the full key is shown once and cannot be recovered.</li>
        <li>Basic operational data such as per-key request counts and last-used time.</li>
      </ul>

      <h2 className="mt-2 text-lg font-bold">What we don’t do</h2>
      <p>We don’t run ads, we don’t use third-party tracking or analytics cookies, and we don’t sell your data. We use a session cookie only to keep you signed in.</p>

      <h2 className="mt-2 text-lg font-bold">Job listings</h2>
      <p>Job listings shown in JobRadar are aggregated from publicly available job boards. They are not about you and are not personal data.</p>

      <h2 className="mt-2 text-lg font-bold">Your controls</h2>
      <p>From Settings you can export your data as JSON or permanently delete your account. Deleting removes your profile, saved state, settings and API keys.</p>
    </article>
  );
}
