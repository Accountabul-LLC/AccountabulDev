import type { ComponentType, ReactNode } from "react";

export function AuthCard({
  icon: Icon,
  title,
  subtitle,
  children,
  footer,
}: {
  icon?: ComponentType<{ className?: string; size?: number; "aria-hidden"?: boolean }>;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="surface-card w-full max-w-md p-6">
      <div className="mb-6">
        {Icon ? (
          <span className="mb-4 inline-flex size-11 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Icon aria-hidden size={20} />
          </span>
        ) : null}
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
      {footer ? <div className="mt-5 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
