import { Landing } from "@/components/marketing/Landing";

// Static landing for signed-out visitors: the proxy rewrites anonymous "/" here
// (URL unchanged), so it is served from the prerendered shell instead of a
// request-time render. Content is the same <Landing /> the dashboard route
// falls back to.
export const metadata = { alternates: { canonical: "/" } };

export default function WelcomePage() {
  return <Landing />;
}
