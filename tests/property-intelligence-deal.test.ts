import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDeal,
  createDefaultDealInputs,
  normalizeDealTranscript,
  normalizeDealInputs,
  parseSpokenNumber,
} from "../src/lib/property-intelligence/deal-analysis.ts";
import {
  applyPropertyTypeDefaults,
  applyRefinanceDefaults,
  applyRentBasedEstimates,
  buildDealAutofill,
} from "../src/lib/property-intelligence/deal-autofill.ts";
import {
  formatDealMoneyInput,
  normalizeDealMoneyText,
  parseDealMoneyInput,
} from "../src/lib/property-intelligence/deal-input-format.ts";

function advancedScenario() {
  return {
    ...createDefaultDealInputs(),
    propertyType: "duplex",
    units: 2,
    purchasePrice: 100_000,
    closingCostPercent: 3.5,
    rehabBudget: 20_000,
    downPayment: 20_000,
    closingCosts: 3_500,
    appraisalFee: 500,
    inspectionFee: 400,
    loanPoints: 1_000,
    loanAmount: 80_000,
    interestRatePercent: 6,
    fundingSources: [
      {
        id: "credit-1",
        name: "Acquisition line",
        amount: 20_000,
        ratePercent: 10,
        termMonths: 12,
        type: "credit",
        confirmed: true,
      },
    ],
    operatingExpenses: [
      { id: "tax", name: "Taxes", monthlyAmount: 100, category: "taxes" },
      { id: "insurance", name: "Insurance", monthlyAmount: 100, category: "insurance" },
      { id: "maintenance", name: "Maintenance", monthlyAmount: 150, category: "maintenance" },
      { id: "management", name: "Management", monthlyAmount: 150, category: "management" },
    ],
    incomeUnits: [
      { id: "unit-1", label: "Unit 1", monthlyRent: 1_500, occupied: true },
      { id: "unit-2", label: "Unit 2", monthlyRent: 1_500, occupied: true },
    ],
    otherIncome: [{ id: "parking", name: "Parking", monthlyAmount: 100 }],
  };
}

test("advanced deal math includes every unit, expense, debt and funding carry", () => {
  const results = calculateDeal(advancedScenario());
  assert.equal(results.complete, true);
  assert.equal(results.allInCost, 125_400);
  assert.equal(results.cashToClose, 45_400);
  assert.equal(results.loanAmount, 80_000);
  assert.equal(results.fundingTotal, 20_000);
  assert.equal(results.fundingGap, 25_400);
  assert.equal(Math.round(results.fundingCarryMonthly), 167);
  assert.equal(results.monthlyGrossIncome, 3_100);
  assert.equal(results.monthlyOperatingExpenses, 500);
  assert.equal(results.monthlyNoi, 2_600);
  assert.equal(Math.round(results.monthlyDebtService), 480);
  assert.equal(Math.round(results.monthlyCashFlow), 1_954);
  assert.ok((results.dscr ?? 0) > 4);
  assert.ok(results.signals.some((signal) => /title are not established/i.test(signal.text)));
});

test("missing, negative, and exact break-even scenarios remain distinct", () => {
  const incomplete = calculateDeal(createDefaultDealInputs());
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.missingInputs, ["purchase price", "rent for at least one unit"]);

  const negative = calculateDeal({
    ...createDefaultDealInputs(),
    purchasePrice: 300_000,
    incomeUnits: [{ id: "unit-1", label: "Unit 1", monthlyRent: 500, occupied: true }],
  });
  assert.ok(negative.monthlyCashFlow < 0);
  assert.ok(
    negative.signals.some(
      (signal) => signal.level === "attention" && /negative/i.test(signal.text),
    ),
  );

  const breakEven = calculateDeal({
    ...createDefaultDealInputs(),
    purchasePrice: 100_000,
    closingCostPercent: 3.5,
    downPayment: 100_000,
    operatingExpenses: [
      { id: "expense-1", name: "Operating costs", monthlyAmount: 1_000, category: "other" },
    ],
    incomeUnits: [{ id: "unit-1", label: "Unit 1", monthlyRent: 1_000, occupied: true }],
  });
  assert.equal(breakEven.monthlyCashFlow, 0);
  assert.ok(
    breakEven.signals.some(
      (signal) => signal.level === "unknown" && /exactly break-even/i.test(signal.text),
    ),
  );
  assert.ok(
    !breakEven.signals.some(
      (signal) => signal.level === "positive" && /cash flow/i.test(signal.text),
    ),
  );
});

test("advanced inputs are normalized to explicit product limits", () => {
  const normalized = normalizeDealInputs({
    units: 500,
    purchasePrice: -1,
    interestRatePercent: 90,
    amortizationYears: 100,
    incomeUnits: [{ id: "unsafe id!", label: " Unit A ", monthlyRent: "2400", occupied: true }],
  });
  assert.equal(normalized.units, 200);
  assert.equal(normalized.purchasePrice, 0);
  assert.equal(normalized.interestRatePercent, 50);
  assert.equal(normalized.amortizationYears, 50);
  assert.equal(normalized.incomeUnits[0].id, "unsafe-id-");
  assert.equal(normalized.incomeUnits[0].monthlyRent, 2_400);
  assert.equal(normalized.incomeUnits.length, 200);
});

test("legacy saved scenarios migrate into the advanced contract", () => {
  const normalized = normalizeDealInputs({
    purchasePrice: 100_000,
    downPaymentPercent: 20,
    loanTermYears: 30,
    monthlyRent: 1_500,
    monthlyOtherIncome: 75,
    annualPropertyTaxes: 1_200,
    annualInsurance: 1_800,
    vacancyPercent: 5,
    maintenancePercent: 8,
    managementPercent: 8,
  });
  assert.equal(normalized.downPayment, 20_000);
  assert.equal(normalized.incomeUnits[0].monthlyRent, 1_500);
  assert.equal(normalized.otherIncome[0].monthlyAmount, 75);
  assert.equal(
    normalized.operatingExpenses.find((row) => row.category === "taxes")?.monthlyAmount,
    100,
  );
  assert.equal(
    normalized.operatingExpenses.find((row) => row.category === "insurance")?.monthlyAmount,
    150,
  );
  assert.equal(
    normalized.operatingExpenses.some(
      (row) => row.id === "expense-vacancy" || row.category === "vacancy",
    ),
    false,
  );
});

test("closing costs default to five percent of purchase price and remain adjustable", () => {
  const defaulted = normalizeDealInputs({ ...createDefaultDealInputs(), purchasePrice: 200_000 });
  assert.equal(defaulted.closingCostPercent, 5);
  assert.equal(defaulted.closingCosts, 10_000);
  const adjusted = normalizeDealInputs({ ...defaulted, closingCostPercent: 3 });
  assert.equal(adjusted.closingCosts, 6_000);
});

test("cash purchases have no loan balance or repayment terms", () => {
  const results = calculateDeal({
    ...createDefaultDealInputs(),
    purchaseFinancing: "cash",
    purchasePrice: 100_000,
    downPayment: 1,
    loanAmount: 90_000,
    incomeUnits: [{ id: "unit-1", label: "Unit 1", monthlyRent: 1_500, occupied: true }],
    fundingSources: [
      { id: "cash", name: "Buyer cash", amount: 105_000, type: "cash", confirmed: true },
    ],
  });
  assert.equal(results.loanAmount, 0);
  assert.equal(results.monthlyDebtService, 0);
  assert.equal(results.fundingCarryMonthly, 0);
  assert.equal(results.cashToClose, 105_000);
});

test("credit cards expose intro and post-intro payments while cash is capped at the deal need", () => {
  const results = calculateDeal({
    ...createDefaultDealInputs(),
    purchasePrice: 100_000,
    downPayment: 20_000,
    incomeUnits: [{ id: "unit-1", label: "Unit 1", monthlyRent: 1_500, occupied: true }],
    fundingSources: [
      {
        id: "card",
        name: "Actual card",
        amount: 10_000,
        type: "credit_card",
        ratePercent: 30,
        introRatePercent: 0,
        introMonths: 12,
        minimumPaymentPercent: 2,
        minimumPaymentAmount: 25,
        annualFee: 120,
        repayment: "minimum_payment",
        useIntroRate: true,
        confirmed: true,
      },
      { id: "cash", name: "Buyer cash", amount: 200_000, type: "cash", confirmed: true },
    ],
  });
  assert.equal(results.fundingCarryMonthly, 210);
  assert.equal(results.fundingPaymentAfterIntroMonthly, 260);
  assert.equal(results.fundingGap, 0);
  assert.equal(results.cashInvested, results.cashToClose - 10_000);
});

test("funding sources normalize concrete instrument and safe account identity fields", () => {
  const normalized = normalizeDealInputs({
    ...createDefaultDealInputs(),
    fundingSources: [
      {
        id: "card-1",
        name: "Ink Business Unlimited",
        provider: "Chase",
        productId: "chase-ink-business-unlimited",
        subtype: "business_credit_card",
        accountNickname: "Rehab card",
        lastFour: "ending 98765",
        amount: 12_000,
        type: "credit_card",
        confirmed: true,
      },
      {
        id: "note-1",
        name: "Seller carry",
        provider: "Seller",
        subtype: "seller_financed",
        amount: 20_000,
        type: "note",
        confirmed: true,
      },
    ],
  });
  assert.equal(normalized.fundingSources[0].subtype, "business_credit_card");
  assert.equal(normalized.fundingSources[0].accountNickname, "Rehab card");
  assert.equal(normalized.fundingSources[0].lastFour, "8765");
  assert.equal(normalized.fundingSources[1].subtype, "seller_financed");

  const invalidSubtype = normalizeDealInputs({
    ...createDefaultDealInputs(),
    fundingSources: [{ id: "equity", type: "equity", subtype: "hard_money" }],
  });
  assert.equal(invalidSubtype.fundingSources[0].subtype, "owner_equity");
});

test("required inputs and outputs follow the selected deal strategy", () => {
  const flipMissing = calculateDeal({
    ...createDefaultDealInputs(),
    strategy: "fix_flip",
    purchasePrice: 80_000,
  });
  assert.deepEqual(flipMissing.missingInputs, ["after-repair value"]);
  const flip = calculateDeal({
    ...createDefaultDealInputs(),
    strategy: "fix_flip",
    purchasePrice: 80_000,
    afterRepairValue: 150_000,
    rehabBudget: 20_000,
  });
  assert.equal(flip.complete, true);
  assert.equal(flip.projectedSalePrice, 150_000);
  assert.ok(flip.projectedProfit > 0);
  assert.ok(flip.dealGrade);
  assert.ok(flip.gradeFactors.length >= 3);
  const land = calculateDeal({
    ...createDefaultDealInputs(),
    strategy: "vacant_land",
    purchasePrice: 20_000,
  });
  assert.deepEqual(land.missingInputs, ["target disposition price"]);
});

test("voice transcripts become the same numeric inputs as keyboard entry", () => {
  assert.equal(parseSpokenNumber("$250,000"), 250_000);
  assert.equal(parseSpokenNumber("two hundred fifty thousand dollars"), 250_000);
  assert.equal(parseSpokenNumber("seven point five percent"), 7.5);
  assert.equal(parseSpokenNumber("pizza"), null);
  const transcript = normalizeDealTranscript([
    {
      field: "purchasePrice",
      transcript: " ninety five thousand ",
      value: 95_000,
      capturedAt: "2026-08-11T20:00:00.000Z",
    },
    { field: "unknown", transcript: "bad", value: 1, capturedAt: "bad" },
  ]);
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].transcript, "ninety five thousand");
});

test("deal cash inputs group thousands without changing their numeric value", () => {
  assert.equal(formatDealMoneyInput(1_000), "1,000");
  assert.equal(formatDealMoneyInput(10_000), "10,000");
  assert.equal(formatDealMoneyInput(1_234.5), "1,234.5");
  assert.equal(normalizeDealMoneyText("$12,345.678"), "12,345.67");
  assert.equal(parseDealMoneyInput("12,345.67"), 12_345.67);
  assert.equal(parseDealMoneyInput(""), 0);
});

test("refinance analysis is optional and checks the selected LTV limit", () => {
  const results = calculateDeal({
    ...advancedScenario(),
    refinanceEnabled: true,
    lenderAppraisedValue: 150_000,
    refinanceValueBasis: "lender",
    currentLoanBalance: 80_000,
    currentInterestRatePercent: 7,
    currentRemainingYears: 28,
    newLoanAmount: 120_000,
    newInterestRatePercent: 6,
    newLoanTermYears: 30,
    refinanceClosingCosts: 4_000,
    ltvLimitPercent: 75,
  });
  assert.equal(results.maxAllowedLoan, 112_500);
  assert.equal(results.exceedsLtv, true);
  assert.ok(results.signals.some((signal) => /exceeds the selected LTV/i.test(signal.text)));
});

test("property intake and Assessor facts prefill an editable duplex analysis", () => {
  const intake = {
    threadId: "thread:1",
    propertyId: "property:1",
    parcelId: "52939410000",
    address: "3301 CALIFORNIA AV",
    profile: {
      lotSquareFeet: 5000,
      ward: 7,
      taxBalance: 147.57,
      priorTaxAmount: 2400,
      propertyClassCode: 17,
      isTaxAbated: false,
      abatementStartYear: null,
      abatementEndYear: null,
      webMercatorX: null,
      webMercatorY: null,
      cityBlock: 1,
      parcelNumber: 1,
      ownerName: null,
      ownerName2: null,
      legalDescription: null,
      assessorClassCode: null,
      landUseCode: null,
      vacantLot: false,
      numberOfUnits: 1,
      numberOfApartments: 1,
      frontageFeet: null,
      landArea: null,
      assessedLandValue: null,
      assessedImprovementValue: null,
      assessedTotalValue: null,
      appraisedLandValue: 40000,
      appraisedImprovementValue: 160000,
      zoning: null,
      residentialBuildingCount: 1,
      commercialBuildingCount: 0,
      firstYearBuilt: null,
      lastYearBuilt: null,
      lastResidentialSalePrice: null,
      lastResidentialSaleDate: null,
      vacantBuildingYear: null,
      neighborhoodCode: "42",
      zipCode: "63118",
      ownerOccupied: false,
      assessorHandle: null,
      sourceUrl:
        "https://maps8.stlouis-mo.gov/arcgis/rest/services/ASSESSOR/PARCEL_PTS/MapServer/0",
      observedAt: "2026-08-11T18:00:00.000Z",
    },
    claims: {
      propertyUse: "duplex",
      bedrooms: null,
      bathrooms: null,
      interiorSquareFeet: null,
      currentOccupancy: "unknown",
      condition: "unknown",
      notes: "",
    },
    updatedAt: "2026-08-11T18:00:00.000Z",
  };
  const autofilled = buildDealAutofill(intake, createDefaultDealInputs());
  assert.equal(autofilled.inputs.propertyType, "duplex");
  assert.equal(autofilled.inputs.units, 2);
  assert.equal(autofilled.inputs.incomeUnits.length, 2);
  assert.equal(autofilled.inputs.assessorValue, 200000);
  assert.equal(autofilled.inputs.appraisalFee, 825);
  assert.equal(autofilled.inputs.inspectionFee, 550);
  assert.equal(
    autofilled.inputs.operatingExpenses.find((row) => row.id === "expense-taxes")?.monthlyAmount,
    200,
  );
  assert.equal(
    autofilled.inputs.operatingExpenses.find((row) => row.id === "expense-gas")?.monthlyAmount,
    130,
  );
  assert.equal(
    autofilled.summary.items.find((item) => item.key === "taxBalance")?.origin,
    "verified",
  );
  assert.equal(
    autofilled.summary.items.find((item) => item.key === "neighborhoodCode")?.value,
    "42",
  );
  assert.match(autofilled.summary.warning, /editable/i);

  const rented = applyRentBasedEstimates({
    ...autofilled.inputs,
    incomeUnits: autofilled.inputs.incomeUnits.map((row) => ({ ...row, monthlyRent: 1500 })),
  });
  assert.equal(
    rented.operatingExpenses.find((row) => row.id === "expense-management")?.monthlyAmount,
    300,
  );
  assert.equal(
    rented.operatingExpenses.some(
      (row) => row.id === "expense-vacancy" || row.category === "vacancy",
    ),
    false,
  );
  assert.equal(
    rented.operatingExpenses.find((row) => row.id === "expense-capex")?.monthlyAmount,
    150,
  );
  const manualManagement = {
    ...rented,
    operatingExpenses: rented.operatingExpenses.map((row) =>
      row.id === "expense-management" ? { ...row, monthlyAmount: 275 } : row,
    ),
  };
  const rentChanged = applyRentBasedEstimates(
    {
      ...manualManagement,
      incomeUnits: manualManagement.incomeUnits.map((row) => ({ ...row, monthlyRent: 1600 })),
    },
    manualManagement,
  );
  assert.equal(
    rentChanged.operatingExpenses.find((row) => row.id === "expense-management")?.monthlyAmount,
    275,
  );

  const triplex = applyPropertyTypeDefaults(createDefaultDealInputs(), "triplex");
  assert.equal(triplex.units, 3);
  assert.equal(triplex.incomeUnits.length, 3);

  const cashOut = applyRefinanceDefaults(
    { ...autofilled.inputs, refinanceValueBasis: "assessor", ltvLimitPercent: 75 },
    "cash_out",
  );
  assert.equal(cashOut.newLoanAmount, 150000);
  assert.equal(cashOut.refinanceClosingCosts, 4500);
});
