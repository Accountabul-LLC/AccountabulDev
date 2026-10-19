# Migration Policy — Accountabul Platform Production

The live backend is the Accountabul-owned Supabase project `PRODUCTION_PROJECT_REF`; schema
lives in `supabase/migrations/` and grows forward-only under the rules below. See
`AGENTS.md` for the active project reference and `docs/SCHEMA.md` /
`docs/RLS_THREAT_MODEL.md` for the current schema and threat model.

## Schema migration rules

1. Forward-only, committed to source control, applied through the migration tool.
2. No dashboard-only schema changes.
3. Each `CREATE TABLE public.x` includes, in order: table, `GRANT`s, `ENABLE ROW LEVEL
SECURITY`, policies.
4. Destructive statements (`DROP`, destructive `ALTER`, data-losing type changes) require
   a written plan, an approved backup, and a rollback runbook before execution.
5. Data changes (`INSERT`/`UPDATE`/`DELETE`) never travel in schema migrations, except
   literal seed rows explicitly required for a first screen.
6. Every schema change is followed by a review of the application code that reads the
   changed tables.

## Data migration (legacy import) rules

Legacy data from the source projects is imported only in Phase 5.

- Importers are **idempotent**: re-running a batch must not duplicate rows.
- Every imported row carries `source_system`, `legacy_id`, `migration_batch_id`, and
  `migrated_at`; mapping lives in `migration_record_map`.
- Unique constraints on `(source_system, legacy_id)` enforce idempotency.
- Every import runs **dry-run first** and emits a reconciliation report: counts in, rows
  created, rows updated, rows skipped, unresolved identities, corrupt or missing assets.
- Unresolved identities and corrupt assets are **reported, never guessed**.
- Money is converted to integer minor units at import time and reconciled against the
  source total before the batch is accepted.
- Media is re-hosted with checksum verification; a failed asset produces an intentional
  fallback, not a broken reference.

## Cutover runbook (Phase 5 deliverable)

1. Freeze legacy writes and record the freeze timestamp.
2. Full backup and restore rehearsal on a scratch environment.
3. Dry-run import; review reconciliation report; resolve exceptions.
4. Live import in batches with per-batch verification.
5. Smoke test critical read/write paths per role.
6. Flip DNS/traffic; keep legacy read-only for the agreed rollback window.
7. Rollback trigger: any unrecoverable data-integrity failure — restore backup, revert
   traffic, and file an incident record.
