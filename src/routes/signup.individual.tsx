import { createFileRoute, Link } from "@tanstack/react-router";

import { SignupForm } from "@/components/auth/signup-form";
import { PageShell } from "@/components/page-shell";

export const Route = createFileRoute("/signup/individual")({
  head: () => ({
    meta: [
      { title: "Individual sign up — Accountabul" },
      {
        name: "description",
        content:
          "Create a free individual Accountabul account to search listings, save favorites, and join live rooms.",
      },
      { property: "og:title", content: "Individual sign up — Accountabul" },
      {
        property: "og:description",
        content:
          "Create a free individual Accountabul account to search listings, save favorites, and join live rooms.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IndividualSignup,
});

function IndividualSignup() {
  return (
    <PageShell
      eyebrow="Individual account"
      title="Create your account"
      description="Search the marketplace, save what you like, and reach verified vendors directly."
      align="center"
    >
      <SignupForm
        variant="individual"
        title="Individual account"
        subtitle="Free forever. Takes about a minute."
        footer={
          <>
            Signing up for a company?{" "}
            <Link
              to="/signup/business"
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              Create a business account
            </Link>
          </>
        }
      />
    </PageShell>
  );
}
