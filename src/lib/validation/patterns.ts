/** UUID versions 1 through 8. The variant nibble is 8, 9, a, or b. */
export const UUID_V1_TO_V8 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** UUID versions 1 through 5. Versions 6, 7, and 8 stay rejected. */
export const UUID_V1_TO_V5 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Lowercase SHA-256 hex. Uppercase digits are rejected. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** SHA-256 hex in either case. */
export const SHA256_HEX_ANY_CASE = /^[0-9a-f]{64}$/i;
