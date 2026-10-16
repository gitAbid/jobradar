import { connection } from "next/server";
import { Settings2 } from "lucide-react";
import { signOut } from "@/auth";
import { requirePageUser } from "@/lib/authz";
import { listApiKeys } from "@/lib/api/keys";
import { apiKeys } from "@/lib/api/keys-store";
import { contextGlobalKeywords, contextSoundEnabled, contextTheme, getUserContext } from "@/lib/user-context";
import { PreferencesForm } from "@/components/settings/PreferencesForm";
import { ThemeForm } from "@/components/settings/ThemeForm";
import { AccountSection } from "./account/AccountSection";
import { ApiKeysSection } from "./api-keys/ApiKeysSection";

export const metadata = { title: "Settings" };

async function logout() {
  "use server";
  await signOut({ redirectTo: "/signin" });
}

export default async function SettingsPage() {
  await connection(); // DB reads must not be prerendered
  const user = await requirePageUser();
  // context is shared with the layout header; keys load alongside it
  const [ctx, keys] = await Promise.all([getUserContext(user.id), listApiKeys(apiKeys(), user.id)]);
  const keywords = contextGlobalKeywords(ctx);
  const sound = contextSoundEnabled(ctx);
  const theme = contextTheme(ctx);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-ink">Your account</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <Settings2 className="h-5 w-5 text-primary" /> Settings
        </h1>
      </header>

      <section id="preferences" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight text-foreground">Matching</h2>
        <p className="text-sm text-muted">
          Your feed is ranked by these keywords, and a ping sounds when a refresh finds new matches.
        </p>
        <PreferencesForm keywords={keywords} sound={sound} />
      </section>

      <section id="appearance" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight text-foreground">Appearance</h2>
        <ThemeForm theme={theme} />
      </section>

      <ApiKeysSection keys={keys} />

      <AccountSection email={user.email} signOutAction={logout} />
    </div>
  );
}
