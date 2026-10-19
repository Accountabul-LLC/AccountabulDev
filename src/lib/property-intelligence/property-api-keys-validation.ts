// Pure request-boundary validation for the sandbox API key server functions
// (property-api-keys.functions.ts). No framework or `@/` imports, mirroring
// report-vault-validation.ts / workspace-validation.ts.

import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

export { UUID };

/** Duplicated from property-api-contract.ts's cleanApiKeyLabel on purpose:
 * keeping this file free of `@/` imports lets it (and the server functions
 * that use it) stay unit-testable under plain `node --test`. */
export function cleanApiKeyLabel(value: unknown) {
  if (typeof value !== "string") throw new Error("Key label is required.");
  const label = value.replace(/\s+/g, " ").trim();
  if (!label) throw new Error("Key label is required.");
  if (label.length > 60) throw new Error("Key label must be 60 characters or fewer.");
  const hasControlCharacter = [...label].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (hasControlCharacter) throw new Error("Key label must contain printable text.");
  return label;
}

export function validateCreateApiKeyInput(input: unknown): { label: string } {
  const data = (input ?? {}) as Record<string, unknown>;
  return { label: cleanApiKeyLabel(data["label"]) };
}

export function validateRevokeApiKeyInput(input: unknown): { keyId: string } {
  const data = (input ?? {}) as Record<string, unknown>;
  const keyId = typeof data["keyId"] === "string" ? data["keyId"] : "";
  if (!UUID.test(keyId)) throw new Error("An API key is required.");
  return { keyId };
}
