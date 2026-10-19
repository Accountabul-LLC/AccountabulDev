import { createFileRoute } from "@tanstack/react-router";

import {
  propertyApiCorsHeaders,
  propertyApiError,
  publicPropertyRecord,
  readBearerKey,
  normalizePublicPropertyQuery,
} from "@/lib/property-intelligence/property-api-contract";

const ROUTE = "/api/public/property-intelligence/v1/parcels";

function requestId() {
  return `req_${crypto.randomUUID()}`;
}

function rateLimitHeaders(limit: number, remaining: number, resetAt: number) {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(resetAt),
  };
}

async function recordUsage(input: {
  keyId: string;
  requestId: string;
  route: string;
  statusCode: number;
  durationMs: number;
  rateLimited: boolean;
}) {
  try {
    const { recordPropertyApiUsage } =
      await import("@/lib/property-intelligence/property-api-repository.server");
    await recordPropertyApiUsage(input);
  } catch (error) {
    console.error("Property API usage event could not be recorded.", error);
  }
}

/**
 * The Property Intelligence public read-only API (sandbox). Serves only
 * property_intel_parcels/property_intel_profiles (Phase 2's already-shipped
 * St. Louis workspace) -- see 20260924160000_property_api_platform.sql's
 * header for the data-source scoping decision. Auth is a bearer sandbox key
 * (property_api_keys.key_hash), rate-limited per key, with a usage event
 * recorded on every request whether it succeeds or fails.
 */
export const Route = createFileRoute("/api/public/property-intelligence/v1/parcels")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const id = requestId();
        const cors = propertyApiCorsHeaders(request, process.env["PROPERTY_API_ALLOWED_ORIGINS"]);
        if (!cors)
          return propertyApiError(
            id,
            "origin_not_allowed",
            "This browser origin is not allowed.",
            403,
          );
        return new Response(null, { status: 204, headers: cors });
      },
      GET: async ({ request }) => {
        const startedAt = Date.now();
        const id = requestId();
        const cors = propertyApiCorsHeaders(request, process.env["PROPERTY_API_ALLOWED_ORIGINS"]);
        if (!cors)
          return propertyApiError(
            id,
            "origin_not_allowed",
            "This browser origin is not allowed.",
            403,
          );

        const presented = readBearerKey(request);
        if (!presented) {
          return propertyApiError(
            id,
            "invalid_api_key",
            "The API key is missing, invalid, or revoked.",
            401,
            cors,
          );
        }

        const { authenticatePropertyApiKey, reservePropertyApiRequest } =
          await import("@/lib/property-intelligence/property-api-repository.server");

        const key = await authenticatePropertyApiKey(presented.rawKey, presented.keyPrefix);
        if (!key) {
          return propertyApiError(
            id,
            "invalid_api_key",
            "The API key is missing, invalid, or revoked.",
            401,
            cors,
          );
        }

        const rate = await reservePropertyApiRequest(key.id);
        const controlledHeaders = new Headers(cors);
        for (const [name, value] of Object.entries(
          rateLimitHeaders(rate.limit, rate.remaining, rate.resetAt),
        )) {
          controlledHeaders.set(name, value);
        }
        if (!rate.allowed) {
          await recordUsage({
            keyId: key.id,
            requestId: id,
            route: ROUTE,
            statusCode: 429,
            durationMs: Date.now() - startedAt,
            rateLimited: true,
          });
          return propertyApiError(
            id,
            "rate_limit_exceeded",
            "The sandbox key has reached its per-minute request limit.",
            429,
            controlledHeaders,
          );
        }

        let search;
        try {
          search = normalizePublicPropertyQuery(new URL(request.url));
        } catch (error) {
          await recordUsage({
            keyId: key.id,
            requestId: id,
            route: ROUTE,
            statusCode: 400,
            durationMs: Date.now() - startedAt,
            rateLimited: false,
          });
          return propertyApiError(
            id,
            "invalid_request",
            error instanceof Error ? error.message : "The property search request is invalid.",
            400,
            controlledHeaders,
          );
        }

        try {
          const { resolvePublicPropertyFeed } =
            await import("@/lib/property-intelligence/property-api-feed.server");
          const page = await resolvePublicPropertyFeed(search);
          await recordUsage({
            keyId: key.id,
            requestId: id,
            route: ROUTE,
            statusCode: 200,
            durationMs: Date.now() - startedAt,
            rateLimited: false,
          });
          controlledHeaders.set("Cache-Control", "private, no-store");
          return Response.json(
            {
              object: "list",
              data: page.rows.map(publicPropertyRecord),
              meta: {
                request_id: id,
                fetched_at: new Date().toISOString(),
                total: page.total,
                next_cursor: page.nextCursor,
                limit: search.pageSize,
              },
            },
            { headers: controlledHeaders },
          );
        } catch (error) {
          console.error("Property API search failed.", error);
          await recordUsage({
            keyId: key.id,
            requestId: id,
            route: ROUTE,
            statusCode: 502,
            durationMs: Date.now() - startedAt,
            rateLimited: false,
          });
          return propertyApiError(
            id,
            "property_feed_unavailable",
            "The property feed is temporarily unavailable.",
            502,
            controlledHeaders,
          );
        }
      },
    },
  },
});
