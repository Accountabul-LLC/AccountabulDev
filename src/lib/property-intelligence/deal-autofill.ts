import type { PropertyIntake, PropertyProfile } from "./analysis-types.ts";
import {
  normalizeDealInputs,
  type DealInputs,
  type OperatingExpense,
  type PropertyType,
  type RefinanceType,
} from "./deal-analysis.ts";

export type DealAutofillItem = {
  key: string;
  label: string;
  value: string;
  origin: "verified" | "private-intake" | "estimate";
  source: string;
};

export type DealAutofillSummary = {
  appliedAt: string;
  items: DealAutofillItem[];
  warning: string;
};

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const unitCountForPropertyType = (type: PropertyType, fallback = 1) => {
  if (type === "single_family" || type === "land_vacant") return 1;
  if (type === "duplex") return 2;
  if (type === "triplex") return 3;
  if (type === "fourplex") return 4;
  return Math.max(1, Math.round(fallback || 1));
};

function typeFromUnits(units: number): PropertyType {
  if (units <= 1) return "single_family";
  if (units === 2) return "duplex";
  if (units === 3) return "triplex";
  if (units === 4) return "fourplex";
  return "multifamily";
}

function profileUnitCount(profile: PropertyProfile | null) {
  return Math.max(profile?.numberOfUnits ?? 0, profile?.numberOfApartments ?? 0, 0);
}

function inferPropertyType(intake: PropertyIntake): {
  type: PropertyType;
  units: number;
  source: string;
  origin: DealAutofillItem["origin"];
} {
  const claimed = intake.claims.propertyUse;
  const claimedTypes: Partial<Record<typeof claimed, PropertyType>> = {
    "single-family": "single_family",
    duplex: "duplex",
    triplex: "triplex",
    fourplex: "fourplex",
    "multi-family": "multifamily",
    commercial: "commercial",
    "mixed-use": "mixed_use",
    land: "land_vacant",
  };
  const fromClaim = claimedTypes[claimed];
  const publishedUnits = profileUnitCount(intake.profile);
  if (fromClaim)
    return {
      type: fromClaim,
      units: unitCountForPropertyType(fromClaim, publishedUnits || 2),
      source: "Your saved property intake",
      origin: "private-intake",
    };
  if (intake.profile?.vacantLot)
    return {
      type: "land_vacant",
      units: 1,
      source: "St. Louis Assessor vacant-lot field",
      origin: "verified",
    };
  if (
    (intake.profile?.commercialBuildingCount ?? 0) > 0 &&
    (intake.profile?.residentialBuildingCount ?? 0) > 0
  )
    return {
      type: "mixed_use",
      units: Math.max(1, publishedUnits),
      source: "St. Louis Assessor building counts",
      origin: "verified",
    };
  if ((intake.profile?.commercialBuildingCount ?? 0) > 0)
    return {
      type: "commercial",
      units: Math.max(1, publishedUnits),
      source: "St. Louis Assessor building counts",
      origin: "verified",
    };
  if (publishedUnits > 0)
    return {
      type: typeFromUnits(publishedUnits),
      units: publishedUnits,
      source: "St. Louis Assessor unit count",
      origin: "verified",
    };
  return {
    type: "single_family",
    units: 1,
    source: "Accountabul residential baseline",
    origin: "estimate",
  };
}

function assessorAppraisal(profile: PropertyProfile | null) {
  const land = profile?.appraisedLandValue ?? 0;
  const improvements = profile?.appraisedImprovementValue ?? 0;
  return land + improvements;
}

function replaceExpense(
  expenses: OperatingExpense[],
  id: string,
  name: string,
  monthlyAmount: number,
  category: OperatingExpense["category"],
) {
  const next = expenses.filter((row) => row.id !== id);
  next.push({ id, name, monthlyAmount: Math.max(0, Math.round(monthlyAmount)), category });
  return next;
}

function inspectionEstimate(type: PropertyType, units: number) {
  if (type === "land_vacant") return 300;
  const commercial = ["commercial", "industrial", "mixed_use"].includes(type) ? 350 : 0;
  return 450 + Math.max(0, units - 1) * 100 + commercial;
}

function appraisalEstimate(type: PropertyType, units: number) {
  if (type === "land_vacant") return 500;
  if (["commercial", "industrial", "mixed_use"].includes(type))
    return 1_200 + Math.max(0, units - 1) * 150;
  return 650 + Math.max(0, units - 1) * 175;
}

function insuranceEstimate(
  type: PropertyType,
  units: number,
  value: number,
  ownerOccupied: boolean | null,
) {
  if (type === "land_vacant")
    return { name: "Vacant land liability insurance estimate", monthly: 55 };
  const rate = ["commercial", "industrial", "mixed_use"].includes(type) ? 0.01 : 0.0075;
  const annual = Math.max(1_200 + Math.max(0, units - 1) * 240, value * rate);
  return {
    name: ownerOccupied
      ? "Homeowners insurance estimate"
      : "Landlord / dwelling insurance estimate",
    monthly: annual / 12,
  };
}

function planningExpenses(inputs: DealInputs, profile: PropertyProfile | null) {
  let expenses = inputs.operatingExpenses.slice();
  const units = inputs.units;
  const residential = !["land_vacant", "commercial", "industrial"].includes(inputs.propertyType);
  const insuranceValue = inputs.asIsValue || inputs.lenderAppraisedValue || inputs.assessorValue;
  const insurance = insuranceEstimate(
    inputs.propertyType,
    units,
    insuranceValue,
    profile?.ownerOccupied ?? null,
  );
  expenses = replaceExpense(
    expenses,
    "expense-insurance",
    insurance.name,
    insurance.monthly,
    "insurance",
  );
  expenses = replaceExpense(
    expenses,
    "expense-gas",
    "Gas utility estimate",
    residential ? 65 * units : 0,
    "utilities",
  );
  expenses = replaceExpense(
    expenses,
    "expense-electric",
    "Electric utility estimate",
    residential ? 85 * units : 0,
    "utilities",
  );
  expenses = replaceExpense(
    expenses,
    "expense-water",
    "Water utility estimate",
    residential ? 45 * units : 0,
    "utilities",
  );
  expenses = replaceExpense(
    expenses,
    "expense-sewer",
    "Sewer utility estimate",
    residential ? 35 * units : 0,
    "utilities",
  );
  const scheduledRent = inputs.incomeUnits
    .slice(0, units)
    .reduce((sum, unit) => sum + unit.monthlyRent, 0);
  expenses = replaceExpense(
    expenses,
    "expense-management",
    "Property management (10% of scheduled rent)",
    scheduledRent * 0.1,
    "management",
  );
  expenses = replaceExpense(
    expenses,
    "expense-maintenance",
    "Maintenance reserve (8% of scheduled rent)",
    scheduledRent * 0.08,
    "maintenance",
  );
  expenses = replaceExpense(
    expenses,
    "expense-capex",
    "Capital expenditure reserve (5% of scheduled rent)",
    scheduledRent * 0.05,
    "capital",
  );
  if (profile?.priorTaxAmount !== null && profile?.priorTaxAmount !== undefined)
    expenses = replaceExpense(
      expenses,
      "expense-taxes",
      "Prior-year property taxes",
      profile.priorTaxAmount / 12,
      "taxes",
    );
  return expenses;
}

function fitIncomeUnits(inputs: DealInputs, units: number) {
  const rows = inputs.incomeUnits.slice(0, units);
  while (rows.length < units)
    rows.push({
      id: `unit-${rows.length + 1}`,
      label: `Unit ${rows.length + 1}`,
      monthlyRent: 0,
      occupied: true,
    });
  return rows;
}

export function applyRentBasedEstimates(input: DealInputs, previousInput?: DealInputs) {
  const inputs = normalizeDealInputs(input);
  const previous = normalizeDealInputs(previousInput ?? input);
  const previousEstimates = planningExpenses(previous, null);
  return {
    ...inputs,
    operatingExpenses: planningExpenses(inputs, null).map((expense) => {
      const current = inputs.operatingExpenses.find((row) => row.id === expense.id);
      if (!["expense-management", "expense-maintenance", "expense-capex"].includes(expense.id))
        return current ?? expense;
      if (!previousInput) return expense;
      const previousEstimate = previousEstimates.find((row) => row.id === expense.id);
      return !current || current.monthlyAmount === previousEstimate?.monthlyAmount
        ? expense
        : current;
    }),
  };
}

export function applyPropertyTypeDefaults(input: DealInputs, propertyType: PropertyType) {
  const current = normalizeDealInputs(input);
  const units = unitCountForPropertyType(propertyType, current.units);
  const next = { ...current, propertyType, units, incomeUnits: fitIncomeUnits(current, units) };
  next.appraisalFee = appraisalEstimate(propertyType, units);
  next.inspectionFee = inspectionEstimate(propertyType, units);
  next.operatingExpenses = planningExpenses(next, null);
  return next;
}

export function applyRefinanceDefaults(input: DealInputs, refinanceType: RefinanceType) {
  const current = normalizeDealInputs(input);
  const currentBalance =
    current.currentLoanBalance ||
    current.loanAmount ||
    Math.max(0, current.purchasePrice - current.downPayment);
  const selectedValue =
    current.refinanceValueBasis === "lender"
      ? current.lenderAppraisedValue
      : current.refinanceValueBasis === "after_repair"
        ? current.afterRepairValue
        : current.refinanceValueBasis === "as_is"
          ? current.asIsValue
          : current.assessorValue;
  const cashOutLoan = (selectedValue * current.ltvLimitPercent) / 100;
  const newLoanAmount = refinanceType === "cash_out" ? cashOutLoan : currentBalance;
  return {
    ...current,
    refinanceEnabled: true,
    refinanceType,
    currentLoanBalance: currentBalance,
    currentInterestRatePercent: current.currentInterestRatePercent || current.interestRatePercent,
    currentRemainingYears: current.currentRemainingYears || current.loanTermYears,
    newLoanAmount: Math.round(newLoanAmount),
    newInterestRatePercent: current.newInterestRatePercent || current.interestRatePercent,
    newLoanTermYears: current.newLoanTermYears || 30,
    refinanceClosingCosts: Math.round(Math.max(1_500, newLoanAmount * 0.03)),
  };
}

export function buildDealAutofill(
  intake: PropertyIntake,
  input: DealInputs,
): { inputs: DealInputs; summary: DealAutofillSummary } {
  const inferred = inferPropertyType(intake);
  const assessorValue = assessorAppraisal(intake.profile);
  const inputs = normalizeDealInputs({
    ...input,
    propertyType: inferred.type,
    units: inferred.units,
    assessorValue: assessorValue || input.assessorValue,
    appraisalFee: appraisalEstimate(inferred.type, inferred.units),
    inspectionFee: inspectionEstimate(inferred.type, inferred.units),
    incomeUnits: fitIncomeUnits(input, inferred.units),
  });
  inputs.operatingExpenses = planningExpenses(inputs, intake.profile);
  const items: DealAutofillItem[] = [
    {
      key: "propertyType",
      label: "Property type",
      value: inferred.type.replaceAll("_", " "),
      origin: inferred.origin,
      source: inferred.source,
    },
    {
      key: "units",
      label: "Unit count",
      value: String(inferred.units),
      origin: inferred.origin,
      source: inferred.source,
    },
    {
      key: "appraisalFee",
      label: "Appraisal fee",
      value: wholeMoney.format(inputs.appraisalFee),
      origin: "estimate",
      source: "Accountabul planning baseline v1",
    },
    {
      key: "inspectionFee",
      label: "Inspection fee",
      value: wholeMoney.format(inputs.inspectionFee),
      origin: "estimate",
      source: "Accountabul planning baseline v1",
    },
    {
      key: "insurance",
      label: "Insurance",
      value:
        wholeMoney.format(
          inputs.operatingExpenses.find((row) => row.id === "expense-insurance")?.monthlyAmount ??
            0,
        ) + "/month",
      origin: "estimate",
      source: "Accountabul planning baseline v1",
    },
  ];
  if (assessorValue)
    items.push({
      key: "assessorValue",
      label: "Assessor market-value estimate",
      value: wholeMoney.format(assessorValue),
      origin: "verified",
      source: "St. Louis Assessor parcel layer",
    });
  if (intake.profile?.neighborhoodCode)
    items.push({
      key: "neighborhoodCode",
      label: "Official neighborhood code",
      value: intake.profile.neighborhoodCode,
      origin: "verified",
      source: "St. Louis Assessor parcel layer",
    });
  if (intake.profile?.priorTaxAmount !== null && intake.profile?.priorTaxAmount !== undefined)
    items.push({
      key: "priorTaxAmount",
      label: "Prior-year property tax",
      value: wholeMoney.format(intake.profile.priorTaxAmount),
      origin: "verified",
      source: "St. Louis Assessor parcel layer",
    });
  if (intake.profile?.taxBalance !== null && intake.profile?.taxBalance !== undefined)
    items.push({
      key: "taxBalance",
      label: "Current tax balance",
      value: wholeMoney.format(intake.profile.taxBalance),
      origin: "verified",
      source: "St. Louis Assessor parcel layer; not treated as an annual expense",
    });
  return {
    inputs,
    summary: {
      appliedAt: new Date().toISOString(),
      items,
      warning:
        "Verified facts and private intake are separated from editable Accountabul planning estimates. Confirm every estimate with a current quote or bill before relying on the projection.",
    },
  };
}
