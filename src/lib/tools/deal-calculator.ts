/**
 * Deal calculator maths.
 *
 * Kept free of React so the same functions back the page, the tests, and
 * anything the host puts on screen during a live event.
 */

export type DealInputs = {
  purchasePrice: number;
  downPaymentPercent: number;
  annualInterestRatePercent: number;
  loanTermYears: number;
  monthlyRent: number;
  vacancyPercent: number;
  monthlyOperatingExpenses: number;
  closingCosts: number;
};

export type DealResults = {
  loanAmount: number;
  cashInvested: number;
  monthlyDebtService: number;
  effectiveMonthlyRent: number;
  monthlyCashFlow: number;
  annualCashFlow: number;
  netOperatingIncome: number;
  capRatePercent: number;
  cashOnCashPercent: number;
  debtServiceCoverageRatio: number;
};

function clampNonNegative(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function percent(value: number) {
  return clampNonNegative(value) / 100;
}

/**
 * Standard amortized payment. A zero-interest loan is straight-line, which the
 * usual formula cannot express because it divides by zero.
 */
export function monthlyPayment(principal: number, annualRatePercent: number, termYears: number) {
  const balance = clampNonNegative(principal);
  const months = Math.round(clampNonNegative(termYears) * 12);
  if (balance === 0 || months === 0) return 0;

  const monthlyRate = percent(annualRatePercent) / 12;
  if (monthlyRate === 0) return balance / months;

  const growth = Math.pow(1 + monthlyRate, months);
  return (balance * monthlyRate * growth) / (growth - 1);
}

export function calculateDeal(inputs: DealInputs): DealResults {
  const price = clampNonNegative(inputs.purchasePrice);
  const downPayment = price * percent(inputs.downPaymentPercent);
  const loanAmount = Math.max(0, price - downPayment);
  const cashInvested = downPayment + clampNonNegative(inputs.closingCosts);

  const monthlyDebtService = monthlyPayment(
    loanAmount,
    inputs.annualInterestRatePercent,
    inputs.loanTermYears,
  );

  const grossMonthlyRent = clampNonNegative(inputs.monthlyRent);
  const effectiveMonthlyRent = grossMonthlyRent * (1 - Math.min(1, percent(inputs.vacancyPercent)));
  const monthlyOperatingExpenses = clampNonNegative(inputs.monthlyOperatingExpenses);

  // NOI is before debt service, by definition.
  const netOperatingIncome = (effectiveMonthlyRent - monthlyOperatingExpenses) * 12;
  const monthlyCashFlow = effectiveMonthlyRent - monthlyOperatingExpenses - monthlyDebtService;
  const annualCashFlow = monthlyCashFlow * 12;
  const annualDebtService = monthlyDebtService * 12;

  return {
    loanAmount,
    cashInvested,
    monthlyDebtService,
    effectiveMonthlyRent,
    monthlyCashFlow,
    annualCashFlow,
    netOperatingIncome,
    // Undefined ratios report as 0 rather than NaN or Infinity.
    capRatePercent: price === 0 ? 0 : (netOperatingIncome / price) * 100,
    cashOnCashPercent: cashInvested === 0 ? 0 : (annualCashFlow / cashInvested) * 100,
    debtServiceCoverageRatio: annualDebtService === 0 ? 0 : netOperatingIncome / annualDebtService,
  };
}

export const DEAL_DEFAULTS: DealInputs = {
  purchasePrice: 250_000,
  downPaymentPercent: 20,
  annualInterestRatePercent: 7,
  loanTermYears: 30,
  monthlyRent: 2_200,
  vacancyPercent: 5,
  monthlyOperatingExpenses: 650,
  closingCosts: 7_500,
};
