// Pure request-boundary validation for the workspace server functions. No
// framework or `@/` imports, so it can be unit tested under plain node.

export const PARCEL_ID = /^\d{11}$/;

/**
 * ACC-20260923-006 boundary: extracts *only* a parcel id from the client's
 * payload. Every other field of a client-supplied "parcel" object — owner
 * name, assessed value, legal description, anything — is structurally
 * dropped here and never reaches the database. The caller is responsible
 * for re-fetching the actual dossier from the Assessor service by this id.
 */
export function validateOpenWorkspaceInput(input: { parcel: unknown }): { parcelId: string } {
  const parcel = input?.parcel as Record<string, unknown> | undefined;
  const parcelId = typeof parcel?.["parcelId"] === "string" ? parcel["parcelId"] : "";
  if (!PARCEL_ID.test(parcelId)) {
    throw new Error("Select an official Assessor parcel match first.");
  }
  return { parcelId };
}
