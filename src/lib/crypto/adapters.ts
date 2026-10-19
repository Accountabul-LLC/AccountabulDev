export type ApprovedCryptoAsset = "BTC" | "ETH" | "XRP" | "SOL" | "USDC" | "USDT";

export type CryptoQuoteRequest = {
  referenceId: string;
  usdAmountMinor: number;
  asset: ApprovedCryptoAsset;
  network: string;
  expiresInSeconds: number;
};

export type CryptoQuote = {
  provider: string;
  providerQuoteId: string;
  exactAssetAmount: string;
  depositAddress: string;
  memo?: string;
  qrPayload: string;
  expiresAt: string;
};

export interface CryptoCheckoutAdapter {
  createQuote(request: CryptoQuoteRequest): Promise<CryptoQuote>;
  getQuote(providerQuoteId: string): Promise<CryptoQuote>;
}

export interface TreasuryAdapter {
  createDepositWallet(input: {
    referenceId: string;
    asset: ApprovedCryptoAsset;
    network: string;
  }): Promise<{
    providerWalletId: string;
    address: string;
    memo?: string;
  }>;
  getTransaction(providerTransactionId: string): Promise<{
    status: "pending" | "confirmed" | "failed";
    confirmations: number;
    amount: string;
    asset: ApprovedCryptoAsset;
    network: string;
  }>;
  sweep(input: { providerWalletId: string; policyId: string }): Promise<{ transactionId: string }>;
}

export class DisabledCryptoCheckoutAdapter implements CryptoCheckoutAdapter {
  async createQuote(): Promise<never> {
    throw new Error("Crypto checkout is disabled until the Palisade sandbox launch gate passes.");
  }

  async getQuote(): Promise<never> {
    throw new Error("Crypto checkout is disabled until the Palisade sandbox launch gate passes.");
  }
}

export class CircleUsdcCheckoutAdapter implements CryptoCheckoutAdapter {
  async createQuote(request: CryptoQuoteRequest): Promise<CryptoQuote> {
    if (request.asset !== "USDC") {
      throw new Error("Only native USDC tips are enabled.");
    }
    const { createCircleUsdcQuote } = await import("./circle-wallets.server");
    return createCircleUsdcQuote({
      tipId: request.referenceId,
      usdAmountMinor: request.usdAmountMinor,
    });
  }

  async getQuote(): Promise<never> {
    throw new Error("USDC quotes are bound to the tip row and are not fetched back from Circle.");
  }
}

export function getCryptoCheckoutAdapter(): CryptoCheckoutAdapter {
  return process.env["CIRCLE_USDC_TIPS_ENABLED"] === "true"
    ? new CircleUsdcCheckoutAdapter()
    : new DisabledCryptoCheckoutAdapter();
}
