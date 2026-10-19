import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, User } from "lucide-react";

import { PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/signup/")({
  head: () => ({
    meta: [
      { title: "Sign up — Accountabul" },
      {
        name: "description",
        content:
          "Create a free Accountabul account as an individual, or open a business vendor account to list properties and services.",
      },
      { property: "og:title", content: "Sign up — Accountabul" },
      {
        property: "og:description",
        content:
          "Create a free Accountabul account as an individual, or open a business vendor account to list properties and services.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignupChooser,
});

const options = [
  {
    to: "/signup/individual" as const,
    icon: User,
    label: "Individual",
    tagline: "Browse, save, and connect",
    points: [
      "Search verified property listings",
      "Save favorites and get reminders",
      "Join live rooms and message vendors",
    ],
  },
  {
    to: "/signup/business" as const,
    icon: Building2,
    label: "Business / Vendor",
    tagline: "Get your own vendor page",
    points: [
      "A public, verified business profile",
      "List properties and services",
      "Receive and manage inbound leads",
    ],
  },
];

function SignupChooser() {
  return (
    <PageShell
      eyebrow="Create your account"
      title="Sign up"
      description="Pick the account that fits you. You can always add a business later."
      align="center"
      contentWidth="wide"
    >
      <div className="grid gap-5 md:grid-cols-2">
        {options.map((option) => (
          <Link
            key={option.to}
            to={option.to}
            className="surface-card group flex flex-col p-6 transition hover:border-accent/60"
          >
            <span className="inline-flex size-11 items-center justify-center rounded-full bg-accent/10 text-accent">
              <option.icon aria-hidden size={20} />
            </span>
            <h2 className="mt-4 text-lg font-semibold">{option.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{option.tagline}</p>
            <ul className="mt-4 grid gap-2 text-sm">
              {option.points.map((point) => (
                <li key={point} className="flex gap-3">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-accent">
              Continue <ArrowRight aria-hidden size={15} />
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </PageShell>
  );
}
