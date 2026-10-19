<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Backend

The live database is the Accountabul-owned Supabase project `YOUR_PROJECT_REF`
(org Accountabul-LLC). Cursor MCP is authenticated to this project. Do not target the
old Lovable-bound project `zvfxmlvtbnesjyugodje`.

Local app keys live in `.env`. The service role must come from the Supabase dashboard
API settings — MCP does not expose it. Auth users and marketplace rows were not copied
from Lovable; this is a schema clone plus seed tiers/standards.

## Security assessment

Authorized assessments use a four-gate workflow: **red team → report → blue team → verification**.

- Roles: `docs/security/ROLES.md` — the charter for all six agent roles (not in git in this public mirror; kept in the private repo)
- Skills: `.claude/skills/{scout,red-team,blue-team,verifier,build-runner,release-steward}/SKILL.md` (not published in this public mirror)
- State: `docs/security/ASSESSMENT_STATE.md`
- Gate: `npm run gate` (`scripts/hourly-gate.mjs`) — no dependencies; run it before every push

The `.cursor/skills/` and `.cursor/rules/` paths this section used to cite were never
committed, so the workflow was not reproducible from a clone (ACC-20260916-003).

Load those files before any security work. Run against staging and test accounts only. The chat that implements a fix cannot declare it closed — verification is a fresh session.

Threat model: `docs/RLS_THREAT_MODEL.md`. Last live lockdown: `docs/security/2026-08-30-access-lockdown.md`. (lockdown report not in git in this public mirror)

## Environments

Two machines, and the difference is load-bearing:

- **Local Claude Code** — full toolchain. The only place `npm run check`
  (typecheck, lint, test, build) can run locally, and the only place the
  `stripe-config` and `stripe-runtime` tests execute.
- **Cloud session** — cannot install `node_modules`. Both lockfiles pin Lovable's
  private npm registry (`europe-west*-npm.pkg.dev`) and the session's egress
  policy answers 403. It runs `npm run gate` and 490 of 494 tests across 67 test
  files; it must never claim a green build. The four it cannot run need an
  installed dependency: `stripe-config` and `stripe-runtime` (Stripe), and
  `property-intelligence-postgres-client` plus one case in
  `property-intelligence-st-louis-lra-live` (`pg`). All four pass in CI.
- **CI** — the `full check (typecheck, lint, test, build)` GitHub Actions job
  installs dependencies and is therefore the authority on a green build; a
  cloud session should cite that job rather than its own partial run.

`scripts/hourly-gate.mjs` uses only the Node standard library so the same gate
runs identically in both.
