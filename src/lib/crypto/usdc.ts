export const USDC_DECIMALS = 6;
export const USDC_BASE_UNITS_PER_USD_CENT = 10_000n;

export const USDC_CONTRACT = {
  BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "BASE-SEPOLIA": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

export const USDC_CHAIN_ID = {
  BASE: 8453,
  "BASE-SEPOLIA": 84532,
} as const;

export type UsdcNetwork = keyof typeof USDC_CONTRACT;

export function usdMinorToUsdcBaseUnits(amountMinor: number) {
  if (!Number.isInteger(amountMinor) || amountMinor < 1) {
    throw new Error("USDC tip amounts must be whole USD cents.");
  }
  return BigInt(amountMinor) * USDC_BASE_UNITS_PER_USD_CENT;
}

export function usdcDecimalToBaseUnits(amount: string) {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Invalid USDC amount.");
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > USDC_DECIMALS) throw new Error("USDC amounts use at most 6 decimals.");
  const padded = fraction.padEnd(USDC_DECIMALS, "0");
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(padded || "0");
}

export function usdcBaseUnitsToDecimal(baseUnits: bigint) {
  const whole = baseUnits / 1_000_000n;
  const fraction = (baseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export function usdcAmountsMatch(usdAmountMinor: number, inboundDecimal: string) {
  return usdMinorToUsdcBaseUnits(usdAmountMinor) === usdcDecimalToBaseUnits(inboundDecimal);
}

export function buildUsdcQrPayload(input: {
  address: string;
  network: UsdcNetwork;
  baseUnits: bigint;
}) {
  const chainId = USDC_CHAIN_ID[input.network];
  const token = USDC_CONTRACT[input.network];
  return `ethereum:${token}@${chainId}/transfer?address=${input.address}&uint256=${input.baseUnits.toString()}`;
}

export function circleBlockchainForEnv(liveMode: boolean): UsdcNetwork {
  return liveMode ? "BASE" : "BASE-SEPOLIA";
}
