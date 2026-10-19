import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  isRoomId,
  parseCommunityRoomInput,
  type CommunityRoomUserReference,
} from "@/lib/community-chat/room-admin";
import { authorizeOperationsRequest } from "@/lib/operations/auth";

const ROOM_COLUMNS =
  "id, slug, name, description, room_kind, sort_order, is_active, access_policy, created_at, updated_at, deleted_at";

export const Route = createFileRoute("/api/internal/ops/community-rooms")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        return listRooms();
      },
      POST: async ({ request }) => mutateRoom(request, false),
      PATCH: async ({ request }) => mutateRoom(request, true),
      DELETE: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const id = await readRoomId(request);
        if (!isRoomId(id)) {
          return Response.json({ error: "A valid room id is required." }, { status: 400 });
        }

        const now = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("community_rooms")
          .update({ deleted_at: now, is_active: false, updated_at: now })
          .eq("id", id)
          .is("deleted_at", null)
          .select(ROOM_COLUMNS)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          return Response.json(
            { error: "That room does not exist or is already deleted." },
            { status: 409 },
          );
        }
        await writeAudit(request, "ops.community_room.deleted", data.id, {
          slug: data.slug,
          fields: ["deleted_at", "is_active"],
        });
        return Response.json({ id: data.id, slug: data.slug, deleted_at: data.deleted_at });
      },
    },
  },
});

async function listRooms() {
  const { data: rooms, error } = await supabaseAdmin
    .from("community_rooms")
    .select(ROOM_COLUMNS)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  const roomRows = rooms ?? [];
  if (roomRows.length === 0) return Response.json({ items: [] });

  const roomIds = roomRows.map((room) => room.id);
  const { data: grants, error: grantsError } = await supabaseAdmin
    .from("community_room_grants")
    .select("id, room_id, grant_kind, role, user_id, created_at")
    .in("room_id", roomIds);
  if (grantsError) throw grantsError;
  const grantRows = grants ?? [];

  const grantedUserIds = [
    ...new Set(grantRows.flatMap((grant) => (grant.user_id ? [grant.user_id] : []))),
  ];
  const profilesById = new Map<string, { handle: string | null; displayName: string | null }>();
  if (grantedUserIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, handle, display_name")
      .in("id", grantedUserIds);
    if (profilesError) throw profilesError;
    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, { handle: profile.handle, displayName: profile.display_name });
    }
  }

  const messageCounts = await Promise.all(
    roomIds.map(async (roomId) => {
      const { count, error: countError } = await supabaseAdmin
        .from("community_messages")
        .select("id", { count: "exact", head: true })
        .eq("room_id", roomId)
        .is("deleted_at", null);
      if (countError) throw countError;
      return [roomId, count ?? 0] as const;
    }),
  );
  const countsByRoom = new Map(messageCounts);

  return Response.json({
    items: roomRows.map((room) => ({
      ...room,
      message_count: countsByRoom.get(room.id) ?? 0,
      grants: grantRows
        .filter((grant) => grant.room_id === room.id)
        .map((grant) => ({
          id: grant.id,
          grant_kind: grant.grant_kind,
          role: grant.role,
          user_id: grant.user_id,
          handle: grant.user_id ? (profilesById.get(grant.user_id)?.handle ?? null) : null,
          display_name: grant.user_id
            ? (profilesById.get(grant.user_id)?.displayName ?? null)
            : null,
          created_at: grant.created_at,
        })),
    })),
  });
}

async function mutateRoom(request: Request, updating: boolean) {
  const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "A valid JSON room request is required." }, { status: 400 });
  }

  const parsed = parseCommunityRoomInput(payload, { updating });
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const room = parsed.value;

  const resolvedUsers = await resolveUserGrants(room.userGrants);
  if (!resolvedUsers.ok) return Response.json({ error: resolvedUsers.error }, { status: 400 });

  const values = {
    slug: room.slug,
    name: room.name,
    description: room.description,
    room_kind: room.roomKind,
    sort_order: room.sortOrder,
    is_active: room.isActive,
    access_policy: room.accessPolicy,
    updated_at: new Date().toISOString(),
  };

  let saved: { id: string; slug: string };
  if (updating && room.id) {
    const { data, error } = await supabaseAdmin
      .from("community_rooms")
      .update(room.restore ? { ...values, deleted_at: null } : values)
      .eq("id", room.id)
      .select("id, slug")
      .maybeSingle();
    if (error) {
      const conflict = slugConflictResponse(error);
      if (conflict) return conflict;
      throw error;
    }
    if (!data) return Response.json({ error: "That room does not exist." }, { status: 404 });
    saved = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from("community_rooms")
      .insert(values)
      .select("id, slug")
      .single();
    if (error) {
      const conflict = slugConflictResponse(error);
      if (conflict) return conflict;
      throw error;
    }
    saved = data;
  }

  const { error: clearError } = await supabaseAdmin
    .from("community_room_grants")
    .delete()
    .eq("room_id", saved.id);
  if (clearError) throw clearError;

  const grantRows = [
    ...room.roleGrants.map((role) => ({
      room_id: saved.id,
      grant_kind: "role" as const,
      role,
      user_id: null,
    })),
    ...resolvedUsers.userIds.map((userId) => ({
      room_id: saved.id,
      grant_kind: "user" as const,
      role: null,
      user_id: userId,
    })),
  ];
  if (grantRows.length > 0) {
    const { error: grantError } = await supabaseAdmin
      .from("community_room_grants")
      .insert(grantRows);
    if (grantError) throw grantError;
  }

  await writeAudit(
    request,
    updating ? "ops.community_room.updated" : "ops.community_room.created",
    saved.id,
    {
      slug: saved.slug,
      access_policy: room.accessPolicy,
      is_active: room.isActive,
      role_grants: room.roleGrants,
      user_grant_count: resolvedUsers.userIds.length,
      restored: updating && room.restore,
      fields: Object.keys(values),
    },
  );

  const { data: stored, error: storedError } = await supabaseAdmin
    .from("community_rooms")
    .select(ROOM_COLUMNS)
    .eq("id", saved.id)
    .single();
  if (storedError) throw storedError;
  return Response.json(stored, { status: updating ? 200 : 201 });
}

async function resolveUserGrants(references: CommunityRoomUserReference[]) {
  const userIds = new Set(
    references.flatMap((reference) => (reference.kind === "id" ? [reference.userId] : [])),
  );
  const handles = [
    ...new Set(
      references.flatMap((reference) => (reference.kind === "handle" ? [reference.handle] : [])),
    ),
  ];

  if (userIds.size > 0) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .in("id", [...userIds]);
    if (error) throw error;
    const known = new Set((data ?? []).map((profile) => profile.id));
    const missing = [...userIds].filter((id) => !known.has(id));
    if (missing.length > 0) {
      return { ok: false as const, error: `Unknown member id: ${missing.join(", ")}` };
    }
  }

  if (handles.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, handle")
      .in("handle", handles);
    if (error) throw error;
    const byHandle = new Map(
      (data ?? []).flatMap((profile) =>
        profile.handle ? [[profile.handle.toLowerCase(), profile.id] as const] : [],
      ),
    );
    const missing = handles.filter((handle) => !byHandle.has(handle));
    if (missing.length > 0) {
      return {
        ok: false as const,
        error: `Unknown member handle: ${missing.map((handle) => `@${handle}`).join(", ")}`,
      };
    }
    for (const handle of handles) {
      const resolved = byHandle.get(handle);
      if (resolved) userIds.add(resolved);
    }
  }

  return { ok: true as const, userIds: [...userIds] };
}

function slugConflictResponse(error: { code?: string | null }) {
  if (error.code !== "23505") return null;
  return Response.json(
    {
      error:
        "Another room already uses that slug. Deleted rooms keep their slug; restore that room or choose a different slug.",
    },
    { status: 409 },
  );
}

async function readRoomId(request: Request) {
  const fromQuery = new URL(request.url).searchParams.get("id")?.trim();
  if (fromQuery) return fromQuery;
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    return typeof payload["id"] === "string" ? payload["id"].trim() : "";
  } catch {
    return "";
  }
}

async function writeAudit(request: Request, action: string, targetId: string, diff: Json) {
  const { error } = await supabaseAdmin.from("audit_log").insert({
    action,
    target_table: "community_rooms",
    target_id: targetId,
    request_id: request.headers.get("x-request-id"),
    diff,
  });
  if (error) throw error;
}
