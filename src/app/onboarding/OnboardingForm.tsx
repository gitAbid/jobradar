"use client";

import { useActionState, useEffect } from "react";
import { Button, Field, Input } from "@/components/ui";
import { completeOnboardingAction, skipOnboardingAction } from "./actions";

const COUNTRIES = ["Bangladesh", "United States", "United Kingdom", "Germany", "Canada", "India", "Netherlands", "Japan", "Singapore", "Australia"];
const SKILLS = ["Java", "Spring Boot", "Kotlin", "Kubernetes", "AWS", "React"];

export function OnboardingForm() {
  const [state, action, pending] = useActionState(completeOnboardingAction, null);
  const [skipState, skip, skipping] = useActionState(skipOnboardingAction, null);
  const href = (state?.ok && state.href) || (skipState?.ok && skipState.href) || null;
  useEffect(() => {
    if (href) window.location.assign(href);
  }, [href]);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-6">
        <Field label="Skills and keywords" hint={`Comma-separated, e.g. ${SKILLS.slice(0, 3).join(", ")}`}>
          <Input name="keywords" placeholder={SKILLS.join(", ")} maxLength={600} autoComplete="off" />
        </Field>
        <fieldset>
          <legend className="text-xs-plus font-semibold text-foreground">Locations</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {COUNTRIES.map((c) => (
              <label key={c} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-surface-raised px-3 text-sm text-foreground has-[:checked]:border-primary has-[:checked]:bg-surface has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary">
                <input type="checkbox" name="country" value={c} className="accent-[var(--primary)]" />
                {c}
              </label>
            ))}
          </div>
        </fieldset>
        {state && !state.ok && (
          <p role="alert" className="text-sm font-semibold text-danger">{state.error}</p>
        )}
        <Button type="submit" pending={pending || !!href} disabled={skipping}>Show my feed</Button>
      </form>
      <form action={skip}>
        <button type="submit" disabled={pending || skipping || !!href} className="min-h-11 text-sm font-medium text-muted underline hover:text-foreground">
          Skip for now
        </button>
      </form>
    </div>
  );
}
