import { BOT_UA } from "@/lib/safe-fetch";

export const metadata = { title: "JobRadarBot" };

export default function BotPage() {
  return (
    <article data-signed-out-page className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-6">
      <h1 className="text-xl font-semibold">JobRadarBot</h1>
      <p>
        JobRadarBot is the crawler behind JobRadar, a personal job-aggregation tool. It
        identifies itself with the user agent <code>{BOT_UA}</code> and fetches
        public job listings at a low rate, a few times a day.
      </p>
      <p>
        It reads and obeys your <code>/robots.txt</code> (RFC 9309) before every request. To
        opt out, add this to your robots.txt and we will stop fetching:
      </p>
      <pre className="rounded bg-black/5 p-3 dark:bg-white/10">
        {"User-agent: JobRadarBot\nDisallow: /"}
      </pre>
      <p>
        Questions or removal requests: contact the site operator at the address listed on the
        site hosting this page.
      </p>
    </article>
  );
}
