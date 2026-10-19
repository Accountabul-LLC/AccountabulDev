/** Lowercase hex for a byte string. Same encoding the webhook and API key helpers used. */
export function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
