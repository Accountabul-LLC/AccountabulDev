import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { opsStatusChangeAllowed, type EventStatus } from "@/lib/conference/live-session";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { trimmedString as stringValue } from "@/lib/validation/strings";

const ACCESS_MODES = new Set(["public", "subscriber", "subscriber_or_pass"]);
const EVENT_STATUSES = new Set(["scheduled", "live", "ended", "canceled", "replay_available"]);

export const Route = createFileRoute("/api/internal/ops/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const { data, error } = await supabaseAdmin
          .from("events")
          .select(
            "id, slug, title, description, scheduled_start_at, actual_start_at, ended_at, status, access_mode, watch_price_minor, allow_watch_purchase, watch_and_chat_price_minor, allow_watch_and_chat_purchase, guest_comment_price_minor, allow_guest_comment, pricing_currency, pass_price_minor, pass_currency, stripe_product_id, stripe_price_id, restream_event_id, provider, provider_record_id, embed_url, replay_url_path, chat_enabled, tips_enabled, speaker_requests_enabled, created_at, updated_at",
          )
          .order("scheduled_start_at", { ascending: false });
        if (error) throw error;
        return Response.json({ items: data ?? [] });
      },
      POST: async ({ request }) => mutateEvent(request, false),
      PATCH: async ({ request }) => mutateEvent(request, true),
    },
  },
});

async function mutateEvent(request: Request, updating: boolean) {
  const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
  const payload = (await request.json()) as Record<string, unknown>;
  const id = stringValue(payload, "id");
  const slug = stringValue(payload, "slug");
  const title = stringValue(payload, "title");
  const requestedStatus = stringValue(payload, "status");
  const accessMode = stringValue(payload, "accessMode") || "public";
  const pricingCurrency = (stringValue(payload, "pricingCurrency") || "USD").toUpperCase();
  const allowWatchPurchase = payload["allowWatchPurchase"] === true;
  const allowWatchAndChatPurchase = payload["allowWatchAndChatPurchase"] === true;
  const allowGuestComment = payload["allowGuestComment"] === true;
  const watchPriceMinor = nullableNonNegativeInt(payload["watchPriceMinor"]);
  const watchAndChatPriceMinor = nullableNonNegativeInt(payload["watchAndChatPriceMinor"]);
  const guestCommentPriceMinor = nullableNonNegativeInt(payload["guestCommentPriceMinor"]);
  const pricesWellFormed = [watchPriceMinor, watchAndChatPriceMinor, guestCommentPriceMinor].every(
    (value) => value === null || Number.isInteger(value),
  );
  const pricingFieldsValid =
    pricesWellFormed &&
    /^[A-Z]{3}$/.test(pricingCurrency) &&
    (!allowWatchPurchase || watchPriceMinor !== null) &&
    (!allowWatchAndChatPurchase || watchAndChatPriceMinor !== null) &&
    (!allowGuestComment || guestCommentPriceMinor !== null);
  if (
    (updating && !id) ||
    !slug ||
    !title ||
    (requestedStatus && !EVENT_STATUSES.has(requestedStatus)) ||
    !ACCESS_MODES.has(accessMode) ||
    !pricingFieldsValid
  ) {
    return Response.json(
      {
        error:
          "Valid id, slug, title, status, access mode, and pricing are required. " +
          "A price of 0 is free; turning an access type on requires a price, even 0.",
      },
      { status: 400 },
    );
  }

  let currentStatus: EventStatus | null = null;
  if (updating) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("events")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return Response.json({ error: "Event not found." }, { status: 404 });
    currentStatus = existing.status;
  }
  // Omitting status on an edit keeps the current one, so renaming a live event
  // can never take it off air.
  const status = (requestedStatus || currentStatus || "scheduled") as EventStatus;
  if (!opsStatusChangeAllowed(currentStatus, status)) {
    return Response.json(
      {
        error:
          status === "live"
            ? "Events go live from the host studio, after the green room and countdown."
            : `An event that is ${currentStatus} cannot be moved to ${status}.`,
      },
      { status: 409 },
    );
  }
  const values = {
    slug,
    title,
    description: nullableString(payload["description"]),
    scheduled_start_at: nullableString(payload["scheduledStartAt"]),
    status,
    ...(currentStatus === "live" && status === "ended"
      ? { ended_at: new Date().toISOString() }
      : {}),
    access_mode: accessMode as "public" | "subscriber" | "subscriber_or_pass",
    allow_watch_purchase: allowWatchPurchase,
    watch_price_minor: watchPriceMinor,
    allow_watch_and_chat_purchase: allowWatchAndChatPurchase,
    watch_and_chat_price_minor: watchAndChatPriceMinor,
    allow_guest_comment: allowGuestComment,
    guest_comment_price_minor: guestCommentPriceMinor,
    pricing_currency: pricingCurrency,
    restream_event_id: nullableString(payload["restreamEventId"]),
    embed_url: nullableString(payload["embedUrl"]),
    replay_url_path: nullableString(payload["replayUrl"]),
    chat_enabled: payload["chatEnabled"] !== false,
    tips_enabled: payload["tipsEnabled"] !== false,
    speaker_requests_enabled: payload["speakerRequestsEnabled"] === true,
  };
  const query = updating
    ? supabaseAdmin.from("events").update(values).eq("id", id)
    : supabaseAdmin.from("events").insert(values);
  const { data, error } = await query
    .select(
      "id, slug, title, status, access_mode, allow_watch_purchase, watch_price_minor, allow_watch_and_chat_purchase, watch_and_chat_price_minor, allow_guest_comment, guest_comment_price_minor, pricing_currency, updated_at",
    )
    .single();
  if (error) throw error;
  const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
    action: updating ? "ops.event.updated" : "ops.event.created",
    target_table: "events",
    target_id: data.id,
    request_id: request.headers.get("x-request-id"),
    diff: { fields: Object.keys(values) },
  });
  if (auditError) throw auditError;
  return Response.json(data, { status: updating ? 200 : 201 });
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
/** null means "not set"; anything else must be a non-negative whole number of minor units (cents). */
function nullableNonNegativeInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}
