import { createHash, createPublicKey, verify } from "node:crypto";

export type PalisadeWebhookEnvelope = {
  domain: "TRANSACTION" | "WALLET" | "APPROVAL";
  timestamp: string;
  payload: string;
};

export function verifyPalisadeWebhook(
  publicKeyBase64: string,
  signatureBase64: string,
  payloadBase64: string,
) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const payloadHash = createHash("sha256").update(payloadBase64).digest();
    return verify(null, payloadHash, publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

export function parsePalisadeWebhook(rawBody: string) {
  const envelope = JSON.parse(rawBody) as Partial<PalisadeWebhookEnvelope>;
  if (
    !envelope ||
    (envelope.domain !== "TRANSACTION" &&
      envelope.domain !== "WALLET" &&
      envelope.domain !== "APPROVAL") ||
    typeof envelope.timestamp !== "string" ||
    typeof envelope.payload !== "string"
  ) {
    throw new Error("Invalid Palisade webhook envelope.");
  }
  const timestamp = new Date(envelope.timestamp);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid Palisade webhook timestamp.");
  const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8")) as Record<
    string,
    unknown
  >;
  const id = typeof payload["id"] === "string" ? payload["id"] : "";
  const updatedAt =
    typeof payload["updatedAt"] === "string" ? payload["updatedAt"] : envelope.timestamp;
  if (!id) throw new Error("Palisade payload is missing its resource ID.");
  return {
    envelope: envelope as PalisadeWebhookEnvelope,
    payload,
    // The provider signs the base64 payload, not the outer domain label. Build
    // replay identity only from signed resource fields so changing an unsigned
    // envelope field cannot bypass deduplication.
    providerEventId: `${id}:${updatedAt}`,
  };
}
