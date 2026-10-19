import type { CSSProperties } from "react";
import { useId } from "react";

export type BrandVariant = "brand" | "mint" | "ink" | "paper" | "current";

const PATHS = [
  "M5 0 A30 30 0 0 0 65 0 Z",
  "M100 5 A30 30 0 0 0 100 65 Z",
  "M95 100 A30 30 0 0 0 35 100 Z",
  "M0 95 A30 30 0 0 0 0 35 Z",
];

export function AccountabulMark({
  variant = "brand",
  className = "size-8",
  title,
}: {
  variant?: BrandVariant;
  className?: string;
  title?: string;
}) {
  const gradientId = useId();
  const gradient =
    variant === "brand"
      ? ["var(--sky)", "var(--periwinkle)"]
      : variant === "mint"
        ? ["var(--mint)", "var(--aqua)"]
        : null;
  const flat =
    variant === "ink"
      ? "var(--ink)"
      : variant === "paper"
        ? "var(--paper)"
        : variant === "current"
          ? "currentColor"
          : null;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {gradient ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={gradient[0]} />
            <stop offset="100%" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
      ) : null}
      {PATHS.map((d) => (
        <path key={d} d={d} fill={flat ?? `url(#${gradientId})`} />
      ))}
    </svg>
  );
}

export function AccountabulWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display font-bold lowercase ${className}`}
      style={{ letterSpacing: "-0.01em" }}
    >
      accountabul
    </span>
  );
}

export function AccountabulLogo({
  variant = "brand",
  className = "",
  markClassName = "size-8",
  wordmarkClassName = "text-xl",
}: {
  variant?: BrandVariant;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`} style={{ minWidth: 150 }}>
      <AccountabulMark variant={variant} className={markClassName} />
      <AccountabulWordmark className={wordmarkClassName} />
    </span>
  );
}

export function BrandPattern({
  variant = "brand",
  className = "",
  style,
}: {
  variant?: BrandVariant;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`grid grid-cols-6 gap-6 opacity-20 ${className}`}
      style={style}
      aria-hidden="true"
    >
      {Array.from({ length: 24 }).map((_, i) => (
        <AccountabulMark
          key={i}
          variant={variant}
          className={`size-8 ${i % 2 ? "translate-y-3" : ""}`}
        />
      ))}
    </div>
  );
}
