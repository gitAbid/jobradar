import { connection } from "next/server";
import { Settings2 } from "lucide-react";
import { signOut } from "@/auth";
import { requirePageUser } from "@/lib/authz";
import { getGlobalKeywords, getTheme, isSoundEnabled } from "@/lib/settings";
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
  const [keywords, sound, theme] = await Promise.all([
    getGlobalKeywords(user.id),
    isSoundEnabled(user.id),
    getTheme(user.id),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Your account</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950">
          <Settings2 className="h-5 w-5 text-teal-600" /> Settings
        </h1>
      </header>

      <section id="preferences" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight text-slate-950">Matching</h2>
        <p className="text-sm text-slate-500">
          Your feed is ranked by these keywords, and a ping sounds when a refresh finds new matches.
        </p>
        <PreferencesForm keywords={keywords} sound={sound} />
      </section>

      <section id="appearance" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight text-slate-950">Appearance</h2>
        <ThemeForm theme={theme} />
      </section>

      <ApiKeysSection userId={user.id} />

      <AccountSection email={user.email} signOutAction={logout} />
    </div>
  );
}
