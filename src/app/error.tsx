"use client"; // Error boundaries must be Client Components

import { ErrorState } from "@/components/ErrorState";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState error={error} retry={retry} />;
}
