import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";
import { trimmedString as stringValue } from "../validation/strings.ts";

export const COMMUNITY_ACCESS_POLICIES = [
  "signed_in",
  "verified_vendor",
  "role_allowlist",
  "user_allowlist",
] as const;

export type CommunityAccessPolicy = (typeof COMMUNITY_ACCESS_POLICIES)[number];

export const COMMUNITY_GRANT_ROLES = [
  "member",
  "business_owner",
  "business_staff",
  "moderator",
  "admin",
] as const;

export type CommunityGrantRole = (typeof COMMUNITY_GRANT_ROLES)[number];

export const MAX_ROOM_NAME_LENGTH = 80;
export const MAX_ROOM_DESCRIPTION_LENGTH = 280;
export const MAX_ROOM_KIND_LENGTH = 40;
export const MAX_ROOM_SORT_ORDER = 10_000;
export const MAX_ROOM_GRANTS = 200;

const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
// Mirrors the profiles_handle_format database constraint.
const HANDLE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function isCommunityAccessPolicy(value: string): value is CommunityAccessPolicy {
  return COMMUNITY_ACCESS_POLICIES.some((policy) => policy === value);
}

export function isCommunityGrantRole(value: string): value is CommunityGrantRole {
  return COMMUNITY_GRANT_ROLES.some((role) => role === value);
}

/** Derive a stable, database-legal slug from an operator-entered room name. */
export function slugifyRoomName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export type CommunityRoomUserReference =
  { kind: "id"; userId: string } | { kind: "handle"; handle: string };

export type ParsedCommunityRoom = {
  id: string | null;
  slug: string;
  name: string;
  description: string | null;
  roomKind: string;
  sortOrder: number;
  isActive: boolean;
  accessPolicy: CommunityAccessPolicy;
  roleGrants: CommunityGrantRole[];
  userGrants: CommunityRoomUserReference[];
  restore: boolean;
};

type ParseSuccess = { ok: true; value: ParsedCommunityRoom };
type ParseFailure = { ok: false; status: number; error: string };

/**
 * Validate an operations-console room payload against the same bounds the
 * database enforces, so a bad request fails with 400 instead of a raw
 * constraint violation. `updating` requires an existing room id.
 */
export function parseCommunityRoomInput(
  payload: unknown,
  options: { updating: boolean },
): ParseSuccess | ParseFailure {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return failure("A JSON object room request is required.");
  }
  const record = payload as Record<string, unknown>;

  const id = stringValue(record, "id");
  if (options.updating && !UUID.test(id)) {
    return failure("A valid room id is required.");
  }
  if (!options.updating && id) {
    return failure("A new room must not carry an id.");
  }

  const name = stringValue(record, "name");
  if (!name || name.length > MAX_ROOM_NAME_LENGTH) {
    return failure(`A room name of 1 to ${MAX_ROOM_NAME_LENGTH} characters is required.`);
  }

  const slug = stringValue(record, "slug") || slugifyRoomName(name);
  if (!SLUG.test(slug)) {
    return failure(
      "A room slug must be 1 to 60 lowercase letters, numbers, or hyphens and start with a letter or number.",
    );
  }

  const description = stringValue(record, "description");
  if (description.length > MAX_ROOM_DESCRIPTION_LENGTH) {
    return failure(`A room description cannot exceed ${MAX_ROOM_DESCRIPTION_LENGTH} characters.`);
  }

  const roomKind = stringValue(record, "roomKind") || "community";
  if (roomKind.length > MAX_ROOM_KIND_LENGTH) {
    return failure(`A room kind cannot exceed ${MAX_ROOM_KIND_LENGTH} characters.`);
  }

  const sortOrderValue = record["sortOrder"] ?? 0;
  const sortOrder = typeof sortOrderValue === "number" ? sortOrderValue : Number.NaN;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > MAX_ROOM_SORT_ORDER) {
    return failure(`A room sort order must be an integer from 0 to ${MAX_ROOM_SORT_ORDER}.`);
  }

  const accessPolicy = stringValue(record, "accessPolicy") || "signed_in";
  if (!isCommunityAccessPolicy(accessPolicy)) {
    return failure("A room access policy must be one of: " + COMMUNITY_ACCESS_POLICIES.join(", "));
  }

  const roleGrantsResult = parseRoleGrants(record["roleGrants"]);
  if (!roleGrantsResult.ok) return roleGrantsResult;
  const userGrantsResult = parseUserGrants(record["userGrants"]);
  if (!userGrantsResult.ok) return userGrantsResult;

  if (roleGrantsResult.value.length + userGrantsResult.value.length > MAX_ROOM_GRANTS) {
    return failure(`A room cannot carry more than ${MAX_ROOM_GRANTS} access grants.`);
  }
  if (accessPolicy === "role_allowlist" && userGrantsResult.value.length > 0) {
    return failure("A role allowlist room cannot carry individual people grants.");
  }
  if (accessPolicy === "user_allowlist" && roleGrantsResult.value.length > 0) {
    return failure("A people allowlist room cannot carry role grants.");
  }

  return {
    ok: true,
    value: {
      id: options.updating ? id : null,
      slug,
      name,
      description: description || null,
      roomKind,
      sortOrder,
      isActive: record["isActive"] !== false,
      accessPolicy,
      roleGrants: roleGrantsResult.value,
      userGrants: userGrantsResult.value,
      restore: record["restore"] === true,
    },
  };
}

function parseRoleGrants(value: unknown): { ok: true; value: CommunityGrantRole[] } | ParseFailure {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return failure("Role grants must be an array of app roles.");
  const roles = new Set<CommunityGrantRole>();
  for (const entry of value) {
    const role = typeof entry === "string" ? entry.trim().toLowerCase() : "";
    if (!isCommunityGrantRole(role)) {
      return failure("Role grants must be one of: " + COMMUNITY_GRANT_ROLES.join(", "));
    }
    roles.add(role);
  }
  return { ok: true, value: [...roles] };
}

function parseUserGrants(
  value: unknown,
): { ok: true; value: CommunityRoomUserReference[] } | ParseFailure {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return failure("People grants must be an array of user ids or @handles.");
  }
  const seen = new Set<string>();
  const references: CommunityRoomUserReference[] = [];
  for (const entry of value) {
    const raw = typeof entry === "string" ? entry.trim() : "";
    if (!raw) return failure("People grants must be non-empty user ids or @handles.");
    if (UUID.test(raw)) {
      const userId = raw.toLowerCase();
      if (seen.has(userId)) continue;
      seen.add(userId);
      references.push({ kind: "id", userId });
      continue;
    }
    const handle = raw.replace(/^@/, "").toLowerCase();
    if (!HANDLE.test(handle)) {
      return failure(`"${raw}" is not a valid user id or @handle.`);
    }
    if (seen.has(handle)) continue;
    seen.add(handle);
    references.push({ kind: "handle", handle });
  }
  return { ok: true, value: references };
}

function failure(error: string, status = 400): ParseFailure {
  return { ok: false, status, error };
}

export function isRoomId(value: string) {
  return UUID.test(value);
}
