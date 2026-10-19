import { useEffect, useState, type ReactNode } from "react";

/**
 * Defers rendering until after hydration. The RealtimeKit SDK touches browser
 * globals at import time, so every room component mounts behind this.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}
