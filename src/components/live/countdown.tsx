import { useEffect, useState } from "react";

import { countdownSecondsLeft } from "@/lib/conference/live-session";

/**
 * Ticks the shared ten-second countdown. `onComplete` fires once, at zero.
 */
export function Countdown({
  startsAt,
  onComplete,
  tone = "audience",
}: {
  startsAt: string;
  onComplete?: () => void;
  tone?: "audience" | "host";
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => countdownSecondsLeft(startsAt));

  useEffect(() => {
    setSecondsLeft(countdownSecondsLeft(startsAt));
    let fired = false;
    const id = setInterval(() => {
      const left = countdownSecondsLeft(startsAt);
      setSecondsLeft(left);
      if (left <= 0 && !fired) {
        fired = true;
        clearInterval(id);
        onComplete?.();
      }
    }, 200);
    return () => clearInterval(id);
  }, [startsAt, onComplete]);

  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 py-10"
      role="status"
      aria-live="polite"
    >
      <span className="text-sm uppercase tracking-wide text-muted-foreground">
        {tone === "host" ? "Going live in" : "Starting in"}
      </span>
      <span className="text-6xl font-semibold tabular-nums">{Math.max(0, secondsLeft)}</span>
      <span className="text-sm text-muted-foreground">
        {tone === "host"
          ? "Your camera goes public at zero."
          : "The host is about to start the room."}
      </span>
    </div>
  );
}
