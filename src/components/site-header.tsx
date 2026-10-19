import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRight, Plus } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useMyBusiness } from "@/hooks/use-business";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { lendersListUrl } from "@/lib/lenders-list";

import { AccountabulMark } from "./accountabul-mark";
import { ThemeToggle } from "./theme-toggle";

const NAV_PANEL_ID = "site-nav-panel";

const nav = [
  { to: "/businesses", label: "Businesses" },
  { to: "/marketplace", label: "Properties" },
  { to: "/live", label: "Live" },
  { to: "/pricing", label: "Pricing" },
] as const;

const authedNav = [
  { to: "/chat", label: "Chat" },
  { to: "/saved", label: "Saved" },
] as const;

function pathMatches(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { session, loading } = useSession();
  const myBusiness = useMyBusiness();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const hasBusiness = Boolean(myBusiness.data?.business_id);
  const addBusinessTo = !session
    ? "/signup/business"
    : hasBusiness
      ? "/dashboard/business"
      : "/onboarding/business";
  const lendersUrl = lendersListUrl();

  function closeMenu() {
    setOpen(false);
  }

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    closeMenu();
    void navigate({ to: "/login", replace: true });
  }

  useEffect(() => {
    closeMenu();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      closeMenu();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  let itemIndex = 0;

  return (
    <header className="accountabul-header">
      <div className="container-page accountabul-nav">
        <div className="accountabul-nav-left">
          <button
            ref={buttonRef}
            type="button"
            className="accountabul-menu-button"
            aria-expanded={open}
            aria-controls={NAV_PANEL_ID}
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setOpen((value) => !value)}
          >
            <AccountabulMark adaptive />
          </button>

          <nav
            ref={panelRef}
            id={NAV_PANEL_ID}
            className="accountabul-nav-panel"
            data-open={open}
            aria-label="Primary"
            aria-hidden={!open}
            inert={!open}
          >
            <p className="accountabul-nav-panel-kicker">Accountabul</p>

            <div className="accountabul-nav-panel-list">
              {nav.map((item) => {
                const index = itemIndex++;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="accountabul-nav-panel-link"
                    data-active={pathMatches(pathname, item.to)}
                    style={{ "--nav-i": index } as CSSProperties}
                    onClick={closeMenu}
                  >
                    {item.label}
                    <ArrowRight aria-hidden className="accountabul-nav-panel-arrow" size={16} />
                  </Link>
                );
              })}
              {lendersUrl ? (
                <a
                  href={lendersUrl}
                  className="accountabul-nav-panel-link"
                  style={{ "--nav-i": itemIndex++ } as CSSProperties}
                  onClick={closeMenu}
                >
                  Lenders List
                  <ArrowRight aria-hidden className="accountabul-nav-panel-arrow" size={16} />
                </a>
              ) : null}
              {session
                ? authedNav.map((item) => {
                    const index = itemIndex++;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className="accountabul-nav-panel-link"
                        data-active={pathMatches(pathname, item.to)}
                        style={{ "--nav-i": index } as CSSProperties}
                        onClick={closeMenu}
                      >
                        {item.label}
                        <ArrowRight aria-hidden className="accountabul-nav-panel-arrow" size={16} />
                      </Link>
                    );
                  })
                : null}
            </div>

            <div className="accountabul-nav-panel-rule" />

            <div className="accountabul-nav-panel-list">
              {loading ? null : session ? (
                <>
                  <Link
                    to="/dashboard"
                    className="accountabul-nav-panel-link accountabul-nav-panel-link-quiet"
                    data-active={pathMatches(pathname, "/dashboard")}
                    style={{ "--nav-i": itemIndex++ } as CSSProperties}
                    onClick={closeMenu}
                  >
                    Account
                  </Link>
                  <button
                    type="button"
                    className="accountabul-nav-panel-link accountabul-nav-panel-link-quiet"
                    style={{ "--nav-i": itemIndex++ } as CSSProperties}
                    onClick={handleSignOut}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  className="accountabul-nav-panel-link accountabul-nav-panel-link-quiet"
                  data-active={pathMatches(pathname, "/login")}
                  style={{ "--nav-i": itemIndex++ } as CSSProperties}
                  onClick={closeMenu}
                >
                  Log in
                </Link>
              )}
            </div>
          </nav>

          <Link to="/" className="accountabul-brand" aria-label="Accountabul Businesses home">
            <span className="accountabul-brand-name">accountabul</span>
            <span className="accountabul-brand-rule" aria-hidden="true">
              |
            </span>
            <span className="accountabul-brand-product">Businesses</span>
          </Link>
        </div>

        <div className="accountabul-nav-right">
          <Link
            to={addBusinessTo}
            className="accountabul-nav-primary"
            aria-label="Add Your Business"
          >
            <Plus aria-hidden size={15} />
            <span className="accountabul-cta-full" aria-hidden="true">
              Add Your Business
            </span>
            <span className="accountabul-cta-short" aria-hidden="true">
              Business
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </div>

      <div
        className="accountabul-nav-backdrop"
        data-open={open}
        aria-hidden="true"
        onClick={closeMenu}
      />
    </header>
  );
}
