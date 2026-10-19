import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import type { PropertyIntelligenceAccessMode } from "@/lib/property-intelligence/access";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";

const MODES = new Set<PropertyIntelligenceAccessMode>(["members", "open"]);

/**
 * Owner-flippable switch for ACC-20260923-004: Property Intelligence defaults
 * to active-membership-only. PUT sets the global mode ('members' | 'open').
 * POST/DELETE manage the individual grant allowlist, which always allows
 * access regardless of mode or membership.
 */
export const Route = createFileRoute("/api/internal/ops/property-intelligence-access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const [{ data: settings, error: settingsError }, { data: grants, error: grantsError }] =
          await Promise.all([
            supabaseAdmin
              .from("property_intelligence_settings")
              .select("access_mode, updated_at")
              .eq("id", true)
              .single(),
            supabaseAdmin
              .from("property_intelligence_access_grants")
              .select("user_id, granted_at, note")
              .order("granted_at", { ascending: false }),
          ]);
        if (settingsError) throw settingsError;
        if (grantsError) throw grantsError;
        return Response.json({ accessMode: settings.access_mode, grants: grants ?? [] });
      },
      PUT: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const payload = (await request.json()) as Record<string, unknown>;
        const accessMode = payload["accessMode"] as PropertyIntelligenceAccessMode;
        if (!MODES.has(accessMode)) {
          return Response.json(
            { error: "accessMode must be 'members' or 'open'." },
            { status: 400 },
          );
        }
        const { data, error } = await supabaseAdmin
          .from("property_intelligence_settings")
          .update({ access_mode: accessMode, updated_at: new Date().toISOString() })
          .eq("id", true)
          .select("access_mode, updated_at")
          .single();
        if (error) throw error;
        return Response.json(data);
      },
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const payload = (await request.json()) as Record<string, unknown>;
        const userId = typeof payload["userId"] === "string" ? payload["userId"] : "";
        const note = typeof payload["note"] === "string" ? payload["note"].slice(0, 240) : null;
        if (!UUID.test(userId)) {
          return Response.json({ error: "A valid userId is required." }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from("property_intelligence_access_grants")
          .upsert({ user_id: userId, note, granted_at: new Date().toISOString() })
          .select("user_id, granted_at, note")
          .single();
        if (error) throw error;
        return Response.json(data, { status: 201 });
      },
      DELETE: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const userId = new URL(request.url).searchParams.get("userId") ?? "";
        if (!UUID.test(userId)) {
          return Response.json({ error: "A valid userId is required." }, { status: 400 });
        }
        const { error } = await supabaseAdmin
          .from("property_intelligence_access_grants")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
        return Response.json({ deleted: true });
      },
    },
  },
});
