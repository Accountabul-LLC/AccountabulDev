import { constantTimeEqual } from "../security/constant-time.ts";

export function authorizeOperationsRequest(request: Request, expectedKey: string | undefined) {
  if (!expectedKey)
    return { ok: false as const, status: 503, message: "Operations API is not configured." };

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return { ok: false as const, status: 401, message: "Missing operations bearer token." };
  }

  const supplied = authorization.slice("Bearer ".length);
  if (!constantTimeEqual(supplied, expectedKey)) {
    return { ok: false as const, status: 403, message: "Invalid operations bearer token." };
  }

  return { ok: true as const };
}
