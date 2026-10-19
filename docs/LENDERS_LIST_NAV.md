# Lenders List navigation — design spec

Status: **VERIFYING** (local)  
Lifecycle: IDEA → RESEARCHING → DESIGNING → UNDER_REVIEW → APPROVED → BUILDING → **VERIFYING** → SHIPPED  
Project: `accountabul-final`  
Related product: standalone repo `Accountabul-LLC/lenders-list` (separate Supabase project `nkydlvgdyjakekpxocqj`)

## Purpose

Give Accountabul visitors a visible way to reach Lenders List from the main navigation, so capital providers can find the intake form without hunting the homepage or footer.

Lenders List stays a **separate app and database**. Accountabul ingests it as a **branded subdomain** of accountabul.com, then links to that URL from nav, footer, and the homepage. It does not host the form, share a database, or show a public lender directory.

## Ingest model — Accountabul subdomain

This is how Lenders List becomes “part of the website” without merging repos.

```text
accountabul.com          → this app (marketplace, live, billing)
lenders.accountabul.com  → lenders-list Worker (intake form, its own Supabase)
```

| Layer | What happens | What does not happen |
| --- | --- | --- |
| Brand / DNS | `lenders.accountabul.com` is a CNAME on the Accountabul zone, pointed at the Lenders List Cloudflare Worker. | No `/lenders` route inside `accountabul-final`. |
| This app | `VITE_LENDERS_LIST_URL=https://lenders.accountabul.com`. One helper. Nav / footer / homepage use it. | No iframe, no shared session, no shared keys. |
| Lenders List | Same standalone repo and Supabase project. Set `LENDERS_LIST_ORIGIN` / `PUBLIC_SITE_URL` to the subdomain so origin checks accept it. | No writes into `PRODUCTION_PROJECT_REF`. |

Recommended host: `lenders.accountabul.com`. Product noun, short, matches the nav label. Alternatives: `lenders-list.accountabul.com` or `capital.accountabul.com`.

Until that hostname is live and serving the intake form, leave `VITE_LENDERS_LIST_URL` empty so Accountabul hides every Lenders List link. The expired `workers.dev` preview is not a stand-in.

Same-tab navigation (`target` omitted) is the better fit if the subdomain should feel like another Accountabul surface. A new tab says “you are leaving.” No `rel="noreferrer"` is needed for a first-party subdomain.

## Current state (researched 2026-09-04)

| Surface | Today |
| --- | --- |
| Primary nav (`src/components/site-header.tsx`) | `Businesses`, `Properties`, `Live`, `Pricing`. Signed-in adds `Saved`. Right CTA is `Add Your Business`. **No Lenders List item.** |
| Mobile drawer | Same internal links. **No Lenders List item.** |
| Footer Explore (`src/components/site-footer.tsx`) | Uncommitted `List your capital` → `VITE_LENDERS_LIST_URL` or a **dead** temporary Cloudflare preview. |
| Homepage `#financing` (`src/routes/index.tsx`) | Uncommitted inline “Lenders List” sentence with the same dead fallback. |
| Env | `.env.example` already has `VITE_LENDERS_LIST_URL=`. It is empty locally. |

The Cloudflare URL `https://lenders-list.outstanding-address-f7a.workers.dev` expired. Shipping any nav item that falls back to it will send people to a dead page.

## Decision (recommended)

**One text item in the primary nav and the mobile menu.** Same visual weight as `Properties` / `Live`. Not a second green button.

Reason: `Add Your Business` is already the header CTA. A second button splits attention and crowds the right cluster (search, login, CTA, theme, hamburger). A nav word matches how Accountabul already routes people to other products.

### Copy

- **Label:** `Lenders List`
- **Why this, not “List your capital”:** Nav items are product nouns (`Businesses`, `Properties`, `Live`). Footer can keep the action phrase.
- **Why this, not “Lenders”:** The destination is a separate site. The full name reduces the impression that Accountabul now has an in-app lender marketplace.

### Behavior

- URL from `VITE_LENDERS_LIST_URL` only. Production value is the Accountabul subdomain (`https://lenders.accountabul.com`).
- Same tab. First-party subdomain, not a third-party site.
- If the env var is missing or not `https:`, **do not render the nav item, footer link, or homepage sentence.** Hide beats a dead link.
- One helper owns the URL so header, footer, and homepage cannot drift.

```ts
// src/lib/lenders-list.ts
export function lendersListUrl(): string | null
```

Return the trimmed env value when it starts with `https://`. Otherwise `null`. No hardcoded `workers.dev` fallback.

### Placement

Desktop: after `Pricing` in `.accountabul-nav-links`.  
Mobile: same order, inside `#mobile-nav`, close the drawer on click.  
Footer Explore: keep `List your capital` only when the helper returns a URL.  
Homepage financing: keep the one-sentence pointer only when the helper returns a URL.

## Out of scope (this repo)

- Embedding or iframe-ing the Lenders List form
- Shared Supabase tables or keys
- Shared login / session cookies across the apex and subdomain
- KYC, payments, or a public lender directory
- Changing `Add Your Business`

Attaching `lenders.accountabul.com` to the Lenders List Worker is a **separate publish step** in the `lenders-list` repo (DNS + `LENDERS_LIST_ORIGIN`). Accountabul nav work waits on that URL or stays hidden.

## Build checklist (after APPROVED)

1. Add `src/lib/lenders-list.ts`.
2. Wire `SiteHeader` desktop + mobile.
3. Point footer and homepage at the same helper; remove the expired fallback.
4. Leave `VITE_LENDERS_LIST_URL` empty until `https://lenders.accountabul.com` (or the chosen host) is live.
5. Set the env var on the Accountabul host when the subdomain serves the form.
6. Browser-check desktop and mobile: item appears only with a real URL; stays in the same tab; other nav items still work.

## Approval needed from the project owner

Reply **APPROVED** to build as written, or change any of:

1. Label (`Lenders List` vs `List your capital` vs something else)
2. Text nav link vs a second header button
3. Hide when URL is unset vs always show and risk a dead link
4. Subdomain host (`lenders.accountabul.com` vs `lenders-list` vs `capital`)
5. Same tab vs new tab
