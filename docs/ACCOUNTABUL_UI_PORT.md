# Accountabul UI Port — Lovable Styling Contract

Status: accepted for the public visual-system migration.

Reference: `https://accountabul-rebuilt.accountabul.chatgpt.site/#financing`

## Goal

Bring the reference site's calm, editorial, trust-first visual language into this Lovable
project without replacing its routes, data access, authentication, authorization, payment
handling, or working interactions.

This is a presentation migration. It is not permission to rebuild the application, add
campaign or donation features, introduce lending decisions, or change production
configuration.

## Protected behavior

- Preserve TanStack Start routing and route metadata.
- Preserve Supabase/Lovable Cloud session and authorization boundaries.
- Preserve Stripe webhook behavior and tests.
- Keep campaigns, donations, wallets, and tokenization out of scope.
- A financing surface may explain and prepare an inquiry, but must not imply that
  Accountabul approves, originates, or guarantees financing.
- Do not present mock property, provider, event, price, yield, ownership, credential, or
  verification data as real. Featured properties must satisfy
  `docs/FEATURED_PROPERTY_REQUIREMENTS.md`.

## Visual direction

The UI should feel trustworthy, calm, premium, warm, and editorial. Its signature is:

- dark evergreen text and major surfaces;
- muted teal actions and verification accents;
- warm ivory page backgrounds;
- Georgia display headings with Arial/Helvetica body copy;
- generous section spacing and disciplined metadata;
- thin gray-green borders, restrained shadows, and 7–14px radii;
- verification, documentation, and traceability as repeated visual motifs.

Avoid generic blue or purple SaaS styling, bright gradients, glass-heavy cards, oversized
pill controls, and excessive animation.

## Source-of-truth tokens

```css
:root {
  --accountabul-ink: #183b3b;
  --accountabul-deep: #123536;
  --accountabul-teal: #1e7774;
  --accountabul-mint: #a9dad0;
  --accountabul-foam: #e4f2ee;
  --accountabul-cream: #f7f4ec;
  --accountabul-paper: #fffdfa;
  --accountabul-line: #d9dfd8;
  --accountabul-muted: #667b76;
  --accountabul-coral: #e28b72;
  --accountabul-success: #4baa84;
  --accountabul-warm: #faf6ee;
  --accountabul-cool: #edf3ee;
  --accountabul-footer: #102f30;

  --font-body: Arial, Helvetica, sans-serif;
  --font-display: Georgia, "Times New Roman", serif;

  --content-max: 1180px;
  --page-gutter: 24px;
  --page-gutter-phone: 15px;

  --radius-button: 7px;
  --radius-card: 11px;
  --radius-panel: 14px;

  --shadow-card: 0 12px 35px rgba(43, 68, 62, 0.05);
  --shadow-hover: 0 18px 45px rgba(30, 63, 58, 0.11);
  --shadow-panel: 0 24px 60px rgba(26, 59, 54, 0.09);
}
```

## Typography

- Body, navigation, forms, labels, and buttons: Arial/Helvetica.
- Hero and section headings, property names, and prominent figures: Georgia.
- Hero heading: up to `74px`, weight `400`, line-height `.98`, negative tracking.
- Section headings: about `52px` desktop and `40px` phone.
- Kicker labels: `11px`, uppercase, weight `800`, letter-spacing `.18em`.
- Body copy: `14–18px`, line-height `1.6–1.7`.
- Metadata: `8–11px`, often uppercase with increased tracking.

## Layout and spacing

- Center content at `1180px` maximum width.
- Use `24px` side gutters on desktop/tablet and `15px` on phones.
- Use `110–115px` vertical padding for major desktop sections and `80px` on phones.
- Use approximately `22px` between cards.
- Use breakpoints at `900px` and `640px`.
- Three-column grids become two columns at `900px` and one at `640px`.
- No horizontal scrolling at 320, 375, 768, 1024, or 1440 pixels.

## Shared components

### Header

- Sticky, `82px` desktop and `70px` phone.
- Paper background at 92% opacity with `14px` backdrop blur.
- Thin bottom border.
- Desktop navigation hides at `900px`; mobile navigation opens below the header.
- Preserve signed-in profile, administrative, and sign-out access.

### Buttons

- Primary: teal background, white text, `15px 22px` padding, `7px` radius.
- Secondary: transparent/paper background, gray-green border, `7px` radius.
- Dark: deep evergreen background, white text.
- Hover movement is limited to `1px`; cards may move up to `4px`.
- All keyboard focus states remain visible.

### Cards

- White or warm-white surfaces.
- Thin gray-green borders and `9–14px` radii.
- Soft evergreen-tinted shadows.
- Small uppercase labels with Georgia titles.

### Footer

- Background `#102f30`, pale green text, and generous spacing.
- Use real application routes; do not add dead or fake links.

## Financing-section recipe

- Full-width `#123536` background with `110px` desktop padding.
- Desktop grid: `.9fr 1.1fr`, aligned center, `100px` gap.
- Stack below `900px` with a `50px` gap.
- Left side: teal kicker, Georgia heading, pale-green copy, left-border disclaimer,
  and teal CTA.
- Right side: `#fdfcf8` request preview, `14px` radius, `28px` padding, and
  `0 25px 60px rgba(0,0,0,.2)` shadow.
- Request details use a bordered 2×2 grid and become one column below `640px`.
- Provider match uses `#eef4f0`, a 48px amber avatar, and a teal fit score.

## Accessibility

- Icon-only controls require accessible names.
- Keyboard focus must be visible.
- Mobile navigation must expose `aria-expanded` and an owned menu.
- Form fields require real labels.
- Respect `prefers-reduced-motion`.
- Images require useful alternative text.
- Decorative glows, dots, and marks are hidden from assistive technology.

## Implementation order

1. Map semantic Tailwind variables to this token system.
2. Restyle shared primitives, header, footer, and page shell.
3. Recompose the homepage using existing application routes and protected behavior.
4. Reuse public reference imagery only as presentation assets.
5. Validate type checking, tests, build, route behavior, and responsive rendering.

## Acceptance criteria

- [ ] Paper background, evergreen text, teal actions, and Georgia display type match the
      reference.
- [ ] Shared header and footer match the reference hierarchy while preserving auth access.
- [ ] Homepage includes the reference's hero, confidence strip, marketplace, trust,
      verified-network, financing-preview, and CTA rhythms.
- [ ] Excluded campaign/donation functionality is not reintroduced.
- [ ] Illustrative images and empty states cannot be mistaken for active listings.
- [ ] Featured property data is server-approved, property-matched, and evidence-backed.
- [ ] Existing public and authenticated routes remain available.
- [ ] Existing forms, auth, Supabase, and Stripe behavior are unchanged.
- [ ] No credentials, migrations, schemas, or deployment settings are modified.
- [ ] Responsive layouts work at 320, 375, 768, 1024, and 1440 pixels.
- [ ] Typecheck, tests, and production build pass.
- [ ] Any pre-existing lint failures are reported separately from changed-file lint results.

> Superseded: the Accountabul brandbook design system (periwinkle/mint, Poppins) is now the source of truth for visual styling. This document is retained for historical reference only.
