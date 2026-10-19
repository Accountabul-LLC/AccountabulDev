import { createFileRoute, Link } from "@tanstack/react-router";

import { SignupForm } from "@/components/auth/signup-form";
import { PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/signup/business")({
  head: () => ({
    meta: [
      { title: "Business vendor sign up — Accountabul" },
      {
        name: "description",
        content:
          "Open a business vendor account on Accountabul to get a verified public page, list properties and services, and receive leads.",
      },
      { property: "og:title", content: "Business vendor sign up — Accountabul" },
      {
        property: "og:description",
        content:
          "Open a business vendor account on Accountabul to get a verified public page, list properties and services, and receive leads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BusinessSignup,
});

function BusinessSignup() {
  return (
    <PageShell
      eyebrow="Business vendor account"
      title="Create your business account"
      description="You get a personal profile plus a business workspace we turn into a public vendor page once verified."
      align="center"
    >
      <SignupForm
        variant="business"
        title="Business account"
        subtitle="Next step is a short onboarding that builds your public vendor page."
        footer={
          <>
            Not a company?{" "}
            <Link
              to="/signup/individual"
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              Create an individual account
            </Link>
          </>
        }
      />
    </PageShell>
  );
}
