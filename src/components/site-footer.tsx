import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ComponentProps } from "react";

import { lendersListUrl } from "@/lib/lenders-list";

import { AccountabulMark } from "./accountabul-mark";

type FooterLink =
  | { to: NonNullable<ComponentProps<typeof Link>["to"]>; label: string }
  | { href: string; label: string };

export function SiteFooter() {
  const lendersUrl = lendersListUrl();
  const exploreLinks: FooterLink[] = [
    { to: "/marketplace", label: "Properties" },
    { to: "/businesses", label: "Verified network" },
    { to: "/live", label: "Live events" },
    ...(lendersUrl ? [{ href: lendersUrl, label: "List your capital" } satisfies FooterLink] : []),
  ];

  return (
    <footer className="accountabul-footer">
      <div className="container-page accountabul-footer-grid">
        <div>
          <Link to="/" className="accountabul-brand accountabul-footer-brand">
            <AccountabulMark variant="mint" />
            <span>accountabul</span>
          </Link>
          <p>Clarity for every property decision.</p>
        </div>
        <FooterColumn title="Explore" links={exploreLinks} />
        <FooterColumn
          title="Participate"
          links={[
            { to: "/signup", label: "Create account" },
            { to: "/saved", label: "Saved properties" },
            { to: "/dashboard", label: "My workspace" },
          ]}
        />
        <div className="accountabul-footer-join">
          <b>Build your accountable record</b>
          <p>Keep opportunities, businesses, and important activity connected.</p>
          <Link to="/signup">
            Get started <ArrowRight aria-hidden size={15} />
          </Link>
        </div>
      </div>
      <div className="container-page accountabul-footer-bottom">
        <span>© {new Date().getFullYear()} Accountabul. Built for trust.</span>
        <span className="accountabul-footer-meta">
          <span>Privacy · Terms · Security</span>
        </span>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <b>{title}</b>
      {links.map((link) =>
        "href" in link ? (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ) : (
          <Link key={String(link.to)} to={link.to}>
            {link.label}
          </Link>
        ),
      )}
    </div>
  );
}
