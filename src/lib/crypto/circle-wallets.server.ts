import { constants, createPublicKey, publicEncrypt } from "node:crypto";

import type { CryptoQuote } from "@/lib/crypto/adapters";
import {
  buildUsdcQrPayload,
  circleBlockchainForEnv,
  usdMinorToUsdcBaseUnits,
  usdcBaseUnitsToDecimal,
  type UsdcNetwork,
} from "@/lib/crypto/usdc";

const CIRCLE_API_BASE = "https://api.circle.com";
const QUOTE_TTL_SECONDS = 15 * 60;

export function isCircleUsdcTipsConfigured() {
  return (
    process.env["CIRCLE_USDC_TIPS_ENABLED"] === "true" &&
    Boolean(process.env["CIRCLE_API_KEY"]) &&
    Boolean(process.env["CIRCLE_ENTITY_SECRET"]) &&
    Boolean(process.env["CIRCLE_WALLET_SET_ID"]) &&
    Boolean(process.env["CIRCLE_WEBHOOK_PUBLIC_KEY"]) &&
    Boolean(process.env["CIRCLE_WEBHOOK_KEY_ID"]) &&
    Boolean(process.env["CIRCLE_USDC_TOKEN_ID"])
  );
}

export function circleUsdcNetwork(): UsdcNetwork {
  return circleBlockchainForEnv(process.env["CIRCLE_LIVE_MODE"] === "true");
}

export function circleUsdcUnavailableResponse() {
  if (isCircleUsdcTipsConfigured()) return null;
  return Response.json({ error: "USDC tips are not available yet." }, { status: 503 });
}

export async function createCircleUsdcQuote(input: {
  tipId: string;
  usdAmountMinor: number;
}): Promise<CryptoQuote> {
  const apiKey = process.env["CIRCLE_API_KEY"];
  const entitySecret = process.env["CIRCLE_ENTITY_SECRET"];
  const walletSetId = process.env["CIRCLE_WALLET_SET_ID"];
  if (!apiKey || !entitySecret || !walletSetId) {
    throw new Error("Circle USDC tips are not configured.");
  }

  const network = circleUsdcNetwork();
  const baseUnits = usdMinorToUsdcBaseUnits(input.usdAmountMinor);
  const entitySecretCiphertext = await encryptEntitySecret(apiKey, entitySecret);
  const created = await circleRequest<{
    data?: { wallets?: Array<{ id?: string; address?: string }> };
  }>(apiKey, "/v1/w3s/developer/wallets", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: input.tipId,
      entitySecretCiphertext,
      walletSetId,
      accountType: "EOA",
      blockchains: [network],
      count: 1,
      metadata: [{ name: "accountabul-tip", refId: input.tipId }],
    }),
  });
  const wallet = created.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) {
    throw new Error("Circle did not return a USDC deposit wallet.");
  }

  const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();
  return {
    provider: "circle",
    providerQuoteId: wallet.id,
    exactAssetAmount: usdcBaseUnitsToDecimal(baseUnits),
    depositAddress: wallet.address,
    qrPayload: buildUsdcQrPayload({
      address: wallet.address,
      network,
      baseUnits,
    }),
    expiresAt,
  };
}

async function encryptEntitySecret(apiKey: string, entitySecret: string) {
  const response = await circleRequest<{ data?: { publicKey?: string } }>(
    apiKey,
    "/v2/w3s/config/entity/publicKey",
    { method: "GET" },
  );
  const publicKeyBase64 = response.data?.publicKey;
  if (!publicKeyBase64) throw new Error("Circle entity public key is unavailable.");
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  return publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(entitySecret, "utf8"),
  ).toString("base64");
}

async function circleRequest<T>(apiKey: string, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${CIRCLE_API_BASE}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Circle request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}
