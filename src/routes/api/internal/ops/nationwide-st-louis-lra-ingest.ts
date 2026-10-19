import { createFileRoute } from "@tanstack/react-router";

import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { runLiveStLouisLraIngestionWithRealDatabase } from "@/lib/property-intelligence/nationwide-live-st-louis-lra.server";

// The activation entry for the staged nationwide rollout: St. Louis LRA only
// (mo_st_louis_lra_inventory_v1, contract version 3). The two row IDs come
// from env, not the request body -- a caller-supplied sourceDefinitionId
// would let an operator point a real ingestion run at an arbitrary row. They
// are only knowable once the nationwide migrations are applied to the live
// project, so an unconfigured deployment answers 503 and stays inert.
export const Route = createFileRoute("/api/internal/ops/nationwide-st-louis-lra-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const sourceDefinitionId = process.env["NATIONWIDE_ST_LOUIS_LRA_SOURCE_DEFINITION_ID"];
        const jurisdictionId = process.env["NATIONWIDE_ST_LOUIS_LRA_JURISDICTION_ID"];
        if (!sourceDefinitionId || !jurisdictionId) {
          return Response.json(
            { error: "Nationwide St. Louis LRA ingestion is not configured." },
            { status: 503 },
          );
        }

        const result = await runLiveStLouisLraIngestionWithRealDatabase({
          sourceDefinitionId,
          jurisdictionId,
        });
        return Response.json(result);
      },
    },
  },
});
