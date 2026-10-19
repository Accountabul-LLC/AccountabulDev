import { constantTimeEqual } from "./constant-time.ts";

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function emailsMatch(left: string, right: string) {
  return constantTimeEqual(normalizeEmail(left), normalizeEmail(right));
}
