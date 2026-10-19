import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAfterResponse } from "@/lib/background.server";
import {
  flagResolutionFor,
  historyActionFor,
  isRestrictionAction,
  parseModerationAction,
  type ParsedModerationAction,
} from "@/lib/community-chat/moderation-admin";
import {
  recordModerationAction,
  sweepUnscreenedMessages,
} from "@/lib/community-chat/moderation.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";

const MESSAGE_COLUMNS =
  "id, room_id, user_id, body, created_at, published_at, hidden_at, hidden_reason, deleted_at, report_count, author_display_name, author_handle, screening";

export const Route = createFileRoute("/api/internal/ops/community-moderation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        // Opening the console also screens anything whose background screening
        // never ran. It does not delay this response.
        runAfterResponse("community-chat-sweep", () => sweepUnscreenedMessages(), request);

        const view = new URL(request.url).searchParams.get("view") ?? "queue";
        if (view === "history") return Response.json(await loadHistory());
        if (view === "restrictions") return Response.json(await loadRestrictions());
        if (view === "queue") return Response.json(await loadQueue());
        return Response.json(
          { error: "view must be queue, history, or restrictions." },
          { status: 400 },
        );
      },
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return Response.json(
            { error: "A valid JSON moderation request is required." },
            { status: 400 },
          );
        }
        const parsed = parseModerationAction(payload);
        if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
        return applyAction(request, parsed.value);
      },
    },
  },
});

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

type Labels = Map<string, { handle: string | null; display_name: string | null }>;

async function profileLabels(userIds: (string | null | undefined)[]): Promise<Labels> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const labels: Labels = new Map();
  if (ids.length === 0) return labels;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, handle, display_name")
    .in("id", ids);
  if (error) throw error;
  for (const row of data ?? []) {
    labels.set(row.id, { handle: row.handle, display_name: row.display_name });
  }
  return labels;
}

async function roomNames(roomIds: (string | null | undefined)[]) {
  const ids = [...new Set(roomIds.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, { name: string; slug: string }>();
  if (ids.length === 0) return names;
  const { data, error } = await supabaseAdmin
    .from("community_rooms")
    .select("id, name, slug")
    .in("id", ids);
  if (error) throw error;
  for (const row of data ?? []) names.set(row.id, { name: row.name, slug: row.slug });
  return names;
}

function person(labels: Labels, userId: string | null) {
  if (!userId) return null;
  const label = labels.get(userId);
  return {
    user_id: userId,
    handle: label?.handle ?? null,
    display_name: label?.display_name ?? null,
  };
}

/** Open flags grouped by message: each item is one message needing attention. */
async function loadQueue() {
  const { data: flags, error } = await supabaseAdmin
    .from("community_message_flags")
    .select(
      "id, message_id, room_id, source, category, reporter_user_id, detail, signals, created_at",
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const openFlags = flags ?? [];
  const messageIds = [...new Set(openFlags.map((flag) => flag.message_id))];
  if (messageIds.length === 0) return { items: [] };

  const { data: messages, error: messageError } = await supabaseAdmin
    .from("community_messages")
    .select(MESSAGE_COLUMNS)
    .in("id", messageIds);
  if (messageError) throw messageError;
  const rows = messages ?? [];

  const [labels, rooms, restrictions] = await Promise.all([
    profileLabels([...rows.map((row) => row.user_id), ...openFlags.map((f) => f.reporter_user_id)]),
    roomNames(rows.map((row) => row.room_id)),
    supabaseAdmin
      .from("community_chat_restrictions")
      .select("id, user_id, kind, room_id, expires_at")
      .in("user_id", [...new Set(rows.map((row) => row.user_id))])
      .is("lifted_at", null),
  ]);
  if (restrictions.error) throw restrictions.error;
  const now = Date.now();
  const activeRestrictions = (restrictions.data ?? []).filter(
    (row) => !row.expires_at || new Date(row.expires_at).getTime() > now,
  );

  const items = rows
    .map((message) => {
      const messageFlags = openFlags.filter((flag) => flag.message_id === message.id);
      return {
        message: {
          ...message,
          state: message.deleted_at ? "deleted" : message.hidden_at ? "hidden" : "visible",
        },
        author: person(labels, message.user_id),
        room: {
          id: message.room_id,
          ...(rooms.get(message.room_id) ?? { name: null, slug: null }),
        },
        flags: messageFlags.map((flag) => ({
          id: flag.id,
          source: flag.source,
          category: flag.category,
          detail: flag.detail,
          signals: flag.signals,
          reporter: person(labels, flag.reporter_user_id),
          created_at: flag.created_at,
        })),
        report_count: messageFlags.filter((flag) => flag.source === "member_report").length,
        automated_count: messageFlags.filter((flag) => flag.source === "automated").length,
        latest_flag_at: messageFlags[0]?.created_at ?? null,
        author_restrictions: activeRestrictions.filter((row) => row.user_id === message.user_id),
      };
    })
    .sort((left, right) => (right.latest_flag_at ?? "").localeCompare(left.latest_flag_at ?? ""));

  return { items };
}

async function loadHistory() {
  const { data, error } = await supabaseAdmin
    .from("community_moderation_actions")
    .select(
      "id, action, actor, actor_reference, message_id, room_id, target_user_id, restriction_id, reason, metadata, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const actions = data ?? [];

  const messageIds = [
    ...new Set(actions.flatMap((row) => (row.message_id ? [row.message_id] : []))),
  ];
  const messages = new Map<string, { body: string; created_at: string }>();
  if (messageIds.length > 0) {
    const { data: rows, error: messageError } = await supabaseAdmin
      .from("community_messages")
      .select("id, body, created_at")
      .in("id", messageIds);
    if (messageError) throw messageError;
    for (const row of rows ?? [])
      messages.set(row.id, { body: row.body, created_at: row.created_at });
  }
  const [labels, rooms] = await Promise.all([
    profileLabels(actions.map((row) => row.target_user_id)),
    roomNames(actions.map((row) => row.room_id)),
  ]);

  return {
    items: actions.map((row) => ({
      ...row,
      target: person(labels, row.target_user_id),
      room: row.room_id
        ? { id: row.room_id, ...(rooms.get(row.room_id) ?? { name: null, slug: null }) }
        : null,
      message: row.message_id ? (messages.get(row.message_id) ?? null) : null,
    })),
  };
}

async function loadRestrictions() {
  const { data, error } = await supabaseAdmin
    .from("community_chat_restrictions")
    .select(
      "id, user_id, kind, room_id, reason, expires_at, created_at, created_by, source_message_id",
    )
    .is("lifted_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const now = Date.now();
  const active = (data ?? []).filter(
    (row) => !row.expires_at || new Date(row.expires_at).getTime() > now,
  );
  const [labels, rooms] = await Promise.all([
    profileLabels(active.map((row) => row.user_id)),
    roomNames(active.map((row) => row.room_id)),
  ]);
  return {
    items: active.map((row) => ({
      ...row,
      member: person(labels, row.user_id),
      room: row.room_id
        ? { id: row.room_id, ...(rooms.get(row.room_id) ?? { name: null, slug: null }) }
        : null,
    })),
  };
}

/* ---------------------------------------------------------------------------
 * Actions
 * ------------------------------------------------------------------------ */

async function applyAction(request: Request, input: ParsedModerationAction) {
  const by = { actor: "operator" as const, reference: input.operator };

  // Message context, when the action names a message.
  let message: { id: string; room_id: string; user_id: string } | null = null;
  if (input.messageId) {
    const { data, error } = await supabaseAdmin
      .from("community_messages")
      .select("id, room_id, user_id")
      .eq("id", input.messageId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "That message does not exist." }, { status: 404 });
    message = data;
  }

  const now = new Date().toISOString();
  let changed = true;
  let restrictionId: string | null = input.restrictionId;
  let targetUserId: string | null = input.userId ?? message?.user_id ?? null;
  let roomId: string | null = input.roomId ?? message?.room_id ?? null;

  switch (input.action) {
    case "hide_message": {
      const { data, error } = await supabaseAdmin
        .from("community_messages")
        .update({ hidden_at: now, hidden_reason: input.reason })
        .eq("id", message!.id)
        .is("hidden_at", null)
        .select("id");
      if (error) throw error;
      changed = (data ?? []).length > 0;
      break;
    }
    case "unhide_message": {
      const { data, error } = await supabaseAdmin
        .from("community_messages")
        .update({ hidden_at: null, hidden_reason: null })
        .eq("id", message!.id)
        .not("hidden_at", "is", null)
        .select("id");
      if (error) throw error;
      changed = (data ?? []).length > 0;
      break;
    }
    case "delete_message": {
      const { data, error } = await supabaseAdmin
        .from("community_messages")
        .update({ deleted_at: now })
        .eq("id", message!.id)
        .is("deleted_at", null)
        .select("id");
      if (error) throw error;
      changed = (data ?? []).length > 0;
      break;
    }
    case "restore_message": {
      // Restoring brings a removed message fully back: not deleted, not hidden.
      const { data, error } = await supabaseAdmin
        .from("community_messages")
        .update({ deleted_at: null, hidden_at: null, hidden_reason: null })
        .eq("id", message!.id)
        .or("deleted_at.not.is.null,hidden_at.not.is.null")
        .select("id");
      if (error) throw error;
      changed = (data ?? []).length > 0;
      break;
    }
    case "dismiss_flags":
      break;
    case "mute_user":
    case "remove_from_room":
    case "ban_user": {
      if (!targetUserId) {
        return Response.json(
          { error: "Could not determine which member to restrict." },
          { status: 400 },
        );
      }
      const kind =
        input.action === "mute_user"
          ? "mute"
          : input.action === "ban_user"
            ? "ban"
            : "room_removal";
      // A ban covers all chat; a mute covers one room only when a room was named.
      const restrictionRoom =
        kind === "ban" ? null : kind === "mute" ? (input.roomId ?? null) : roomId;
      roomId = restrictionRoom;
      const { data, error } = await supabaseAdmin
        .from("community_chat_restrictions")
        .insert({
          user_id: targetUserId,
          kind,
          room_id: restrictionRoom,
          reason: input.reason!,
          expires_at: input.durationMinutes
            ? new Date(Date.now() + input.durationMinutes * 60_000).toISOString()
            : null,
          created_by: input.operator,
          source_message_id: message?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      restrictionId = data.id;
      break;
    }
    case "lift_restriction": {
      const { data, error } = await supabaseAdmin
        .from("community_chat_restrictions")
        .update({ lifted_at: now, lift_reason: input.reason })
        .eq("id", input.restrictionId!)
        .is("lifted_at", null)
        .select("id, user_id, room_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return Response.json(
          { error: "That restriction does not exist or was already lifted." },
          { status: 409 },
        );
      }
      targetUserId = data.user_id;
      roomId = data.room_id;
      break;
    }
  }

  if (!changed) {
    return Response.json(
      { error: "The message is already in that state.", changed: false },
      { status: 409 },
    );
  }

  const resolution = flagResolutionFor(input.action);
  let resolvedFlags = 0;
  if (resolution && message) {
    const { data, error } = await supabaseAdmin
      .from("community_message_flags")
      .update({ status: resolution, resolved_at: now, resolution_note: input.reason })
      .eq("message_id", message.id)
      .eq("status", "open")
      .select("id");
    if (error) throw error;
    resolvedFlags = (data ?? []).length;
  }
  if (input.action === "dismiss_flags" && resolvedFlags === 0) {
    return Response.json({ error: "There are no open flags on that message." }, { status: 409 });
  }

  const actionId = await recordModerationAction({
    action: historyActionFor(input.action),
    by,
    messageId: message?.id ?? null,
    roomId,
    targetUserId:
      isRestrictionAction(input.action) || input.action === "lift_restriction"
        ? targetUserId
        : (message?.user_id ?? null),
    restrictionId,
    reason: input.reason,
    metadata: {
      resolved_flags: resolvedFlags,
      ...(input.durationMinutes ? { duration_minutes: input.durationMinutes } : {}),
    },
  });

  const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
    action: `ops.community_moderation.${input.action}`,
    target_table: restrictionId && !message ? "community_chat_restrictions" : "community_messages",
    target_id: message?.id ?? restrictionId,
    request_id: request.headers.get("x-request-id"),
    diff: { moderation_action_id: actionId, resolved_flags: resolvedFlags },
  });
  if (auditError) throw auditError;

  return Response.json({
    action: input.action,
    moderationActionId: actionId,
    restrictionId,
    resolvedFlags,
  });
}
