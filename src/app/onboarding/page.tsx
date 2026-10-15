import { connection } from "next/server";
import { requirePageUser } from "@/lib/authz";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  await connection();
  await requirePageUser();
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-surface-raised p-6 shadow-sm">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Tune your radar</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Tell us which skills and places matter so your feed starts out relevant. You can change this any time in Settings.
      </p>
      <OnboardingForm />
    </div>
  );
}
