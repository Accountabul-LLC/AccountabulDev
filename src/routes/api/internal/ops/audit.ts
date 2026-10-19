import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";

export const Route = createFileRoute("/api/internal/ops/audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const [auditResult, migrationResult] = await Promise.all([
          supabaseAdmin
            .from("audit_log")
            .select(
              "id, actor_user_id, action, target_table, target_id, diff, request_id, created_at",
            )
            .order("created_at", { ascending: false })
            .limit(500),
          supabaseAdmin
            .from("migration_batches")
            .select("id, source_system, status, dry_run, notes, started_at, finished_at")
            .order("started_at", { ascending: false })
            .limit(200),
        ]);
        if (auditResult.error) throw auditResult.error;
        if (migrationResult.error) throw migrationResult.error;
        return Response.json({
          items: auditResult.data ?? [],
          migrationBatches: migrationResult.data ?? [],
        });
      },
    },
  },
});
