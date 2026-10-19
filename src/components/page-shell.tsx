import type { ReactNode } from "react";

export function PageShell({
  eyebrow,
  title,
  description,
  align = "start",
  contentWidth = "md",
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  align?: "start" | "center";
  contentWidth?: "md" | "wide";
  phase?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={
        align === "center"
          ? "container-page accountabul-page-shell flex flex-col items-center text-center"
          : "container-page accountabul-page-shell"
      }
    >
      <div className="max-w-3xl">
        {eyebrow ? <p className="landing-kicker">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="accountabul-page-lead">{description}</p>
      </div>
      <div
        className={
          align === "center"
            ? `mt-10 w-full text-left ${contentWidth === "wide" ? "max-w-4xl" : "max-w-md"}`
            : contentWidth === "wide"
              ? "mt-10 w-full"
              : "mt-10"
        }
      >
        {children}
      </div>
    </div>
  );
}

export function ScopeList({ items }: { items: string[] }) {
  return (
    <section aria-label="Planned scope" className="surface-card p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Planned scope
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
