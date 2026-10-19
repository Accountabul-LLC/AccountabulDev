export const DEAL_CALCULATION_VERSION = 3;

export type PropertyType =
  | "single_family"
  | "duplex"
  | "triplex"
  | "fourplex"
  | "multifamily"
  | "commercial"
  | "industrial"
  | "land_vacant"
  | "mixed_use"
  | "custom";
export type DealStrategy =
  "buy_hold" | "brrrr" | "fix_flip" | "wholesale" | "vacant_land" | "owner_occupied";
export type PurchaseFinancing = "cash" | "mortgage" | "mixed";
export type RefinanceType = "rate_term" | "cash_out";
export type RefinanceValueBasis = "assessor" | "as_is" | "after_repair" | "lender";
export type FundingSourceType =
  "cash" | "mortgage" | "credit_card" | "line_of_credit" | "loan" | "note" | "equity" | "other";
export type FundingAllocation =
  "purchase" | "down_payment" | "closing_costs" | "rehab" | "holding" | "other";
export type FundingRepayment = "none" | "interest_only" | "amortizing" | "minimum_payment";
export type ExpenseCategory =
  | "taxes"
  | "insurance"
  | "utilities"
  | "hoa"
  | "management"
  | "maintenance"
  | "capital"
  | "repairs"
  | "other";

export type FundingSource = {
  id: string;
  name: string;
  provider: string;
  productId: string;
  subtype: string;
  accountNickname: string;
  lastFour: string;
  amount: number;
  ratePercent: number;
  introRatePercent: number;
  introMonths: number;
  termMonths: number;
  amortizationMonths: number;
  minimumPaymentPercent: number;
  minimumPaymentAmount: number;
  annualFee: number;
  upfrontFee: number;
  type: FundingSourceType;
  allocation: FundingAllocation;
  repayment: FundingRepayment;
  useIntroRate: boolean;
  confirmed: boolean;
};
export type OperatingExpense = {
  id: string;
  name: string;
  monthlyAmount: number;
  category: ExpenseCategory;
};
export type IncomeUnit = { id: string; label: string; monthlyRent: number; occupied: boolean };
export type OtherIncome = { id: string; name: string; monthlyAmount: number };

export type DealInputs = {
  strategy: DealStrategy;
  purchaseFinancing: PurchaseFinancing;
  propertyType: PropertyType;
  units: number;
  purchasePrice: number;
  assessorValue: number;
  asIsValue: number;
  afterRepairValue: number;
  lenderAppraisedValue: number;
  rehabBudget: number;
  downPayment: number;
  closingCostPercent: number;
  closingCosts: number;
  appraisalFee: number;
  inspectionFee: number;
  loanPoints: number;
  loanAmount: number;
  interestRatePercent: number;
  loanTermYears: number;
  amortizationYears: number;
  fundingSources: FundingSource[];
  operatingExpenses: OperatingExpense[];
  incomeUnits: IncomeUnit[];
  otherIncome: OtherIncome[];
  targetSalePrice: number;
  sellingCostPercent: number;
  holdingPeriodMonths: number;
  refinanceEnabled: boolean;
  refinanceType: RefinanceType;
  refinanceValueBasis: RefinanceValueBasis;
  currentLoanBalance: number;
  currentInterestRatePercent: number;
  currentRemainingYears: number;
  newLoanAmount: number;
  newInterestRatePercent: number;
  newLoanTermYears: number;
  refinanceClosingCosts: number;
  financeCredits: number;
  cashOutAmount: number;
  ltvLimitPercent: number;
};

export type DealVoiceField = Exclude<
  keyof DealInputs,
  | "fundingSources"
  | "operatingExpenses"
  | "incomeUnits"
  | "otherIncome"
  | "refinanceEnabled"
  | "refinanceType"
  | "refinanceValueBasis"
  | "propertyType"
  | "strategy"
  | "purchaseFinancing"
>;
export type DealTranscriptEntry = {
  field: DealVoiceField;
  transcript: string;
  value: number | null;
  capturedAt: string;
};

export type DealResults = {
  calculationVersion: number;
  complete: boolean;
  missingInputs: string[];
  allInCost: number;
  cashToClose: number;
  loanAmount: number;
  cashInvested: number;
  fundingTotal: number;
  fundingGap: number;
  fundingCarryMonthly: number;
  fundingPaymentAfterIntroMonthly: number;
  monthlyDebtService: number;
  annualDebtService: number;
  monthlyGrossRent: number;
  monthlyOtherIncome: number;
  monthlyGrossIncome: number;
  monthlyOperatingExpenses: number;
  monthlyNoi: number;
  annualNoi: number;
  monthlyCashFlow: number;
  annualCashFlow: number;
  capRatePercent: number | null;
  cashOnCashPercent: number | null;
  dscr: number | null;
  minimumMonthlyRent: number | null;
  occupiedUnits: number;
  currentMonthlyPayment: number;
  newMonthlyPayment: number;
  refinanceMonthlySavings: number;
  refinanceProceeds: number;
  refinanceNet: number;
  refinanceBreakEvenMonths: number | null;
  refinanceLtvPercent: number | null;
  maxAllowedLoan: number;
  exceedsLtv: boolean;
  refinanceValue: number;
  projectedSalePrice: number;
  projectedSellingCosts: number;
  projectedHoldingCosts: number;
  projectedProfit: number | null;
  projectedMarginPercent: number | null;
  dealScore: number | null;
  dealGrade: "A" | "B" | "C" | "D" | "F" | null;
  gradeFactors: Array<{ label: string; points: number; possible: number; explanation: string }>;
  signals: Array<{ level: "positive" | "attention" | "unknown"; text: string }>;
  explanation: string;
};

export const PROPERTY_TYPES: Array<{ value: PropertyType; label: string }> = [
  { value: "single_family", label: "Single family" },
  { value: "duplex", label: "Duplex" },
  { value: "triplex", label: "Triplex" },
  { value: "fourplex", label: "Fourplex" },
  { value: "multifamily", label: "Multifamily" },
  { value: "commercial", label: "Commercial" },
  { value: "industrial", label: "Industrial" },
  { value: "land_vacant", label: "Land / vacant" },
  { value: "mixed_use", label: "Mixed use" },
  { value: "custom", label: "Custom" },
];
export const DEAL_STRATEGIES: Array<{ value: DealStrategy; label: string; description: string }> = [
  {
    value: "buy_hold",
    label: "Buy and hold",
    description: "Long-term rental income and cash flow.",
  },
  { value: "brrrr", label: "BRRRR", description: "Buy, rehab, rent, refinance and repeat." },
  {
    value: "fix_flip",
    label: "Fix and flip",
    description: "Renovate and sell against an after-repair value.",
  },
  {
    value: "wholesale",
    label: "Wholesale",
    description: "Contract the property and model an assignment spread.",
  },
  {
    value: "vacant_land",
    label: "Vacant land",
    description: "Acquire, hold, improve or resell land.",
  },
  {
    value: "owner_occupied",
    label: "Owner occupied",
    description: "Model acquisition and financing without rental-return requirements.",
  },
];
export const PURCHASE_FINANCING_OPTIONS: Array<{ value: PurchaseFinancing; label: string }> = [
  { value: "cash", label: "Cash purchase" },
  { value: "mortgage", label: "Primary mortgage" },
  { value: "mixed", label: "Mixed funding" },
];
export const FUNDING_SOURCE_TYPES: Array<{ value: FundingSourceType; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "mortgage", label: "Mortgage" },
  { value: "credit_card", label: "Credit card" },
  { value: "line_of_credit", label: "Line of credit" },
  { value: "loan", label: "Loan" },
  { value: "note", label: "Note" },
  { value: "equity", label: "Equity" },
  { value: "other", label: "Other" },
];
export const FUNDING_SUBTYPE_OPTIONS: Record<
  FundingSourceType,
  Array<{ value: string; label: string }>
> = {
  cash: [
    { value: "personal_cash", label: "Personal cash" },
    { value: "business_cash", label: "Business cash" },
    { value: "retirement_cash", label: "Retirement funds" },
    { value: "other_cash", label: "Other cash" },
  ],
  mortgage: [
    { value: "conventional", label: "Conventional mortgage" },
    { value: "fha", label: "FHA mortgage" },
    { value: "va", label: "VA mortgage" },
    { value: "dscr", label: "DSCR mortgage" },
    { value: "commercial", label: "Commercial mortgage" },
    { value: "other_mortgage", label: "Other mortgage" },
  ],
  credit_card: [
    { value: "business_credit_card", label: "Business credit card" },
    { value: "personal_credit_card", label: "Personal credit card" },
  ],
  line_of_credit: [
    { value: "business_line", label: "Business line of credit" },
    { value: "heloc", label: "HELOC" },
    { value: "personal_line", label: "Personal line of credit" },
    { value: "other_line", label: "Other line of credit" },
  ],
  loan: [
    { value: "hard_money", label: "Hard-money loan" },
    { value: "private_money", label: "Private-money loan" },
    { value: "business_term", label: "Business term loan" },
    { value: "personal_loan", label: "Personal loan" },
    { value: "other_loan", label: "Other loan" },
  ],
  note: [
    { value: "seller_financed", label: "Seller-financed note" },
    { value: "private_note", label: "Private note" },
    { value: "promissory_note", label: "Promissory note" },
    { value: "other_note", label: "Other note" },
  ],
  equity: [
    { value: "owner_equity", label: "Owner equity" },
    { value: "partner_equity", label: "Partner equity" },
    { value: "investor_equity", label: "Investor equity" },
    { value: "seller_equity", label: "Seller equity" },
    { value: "other_equity", label: "Other equity" },
  ],
  other: [{ value: "other", label: "Other funding source" }],
};
export const FUNDING_ALLOCATIONS: Array<{ value: FundingAllocation; label: string }> = [
  { value: "purchase", label: "Purchase" },
  { value: "down_payment", label: "Down payment" },
  { value: "closing_costs", label: "Closing costs" },
  { value: "rehab", label: "Rehab" },
  { value: "holding", label: "Holding costs" },
  { value: "other", label: "Other" },
];
export const FUNDING_REPAYMENT_OPTIONS: Array<{ value: FundingRepayment; label: string }> = [
  { value: "none", label: "No repayment terms" },
  { value: "interest_only", label: "Interest only" },
  { value: "amortizing", label: "Amortizing payment" },
  { value: "minimum_payment", label: "Card minimum payment" },
];
export const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "taxes", label: "Taxes" },
  { value: "insurance", label: "Insurance" },
  { value: "utilities", label: "Utilities" },
  { value: "hoa", label: "HOA" },
  { value: "management", label: "Management" },
  { value: "maintenance", label: "Maintenance" },
  { value: "capital", label: "Capital expenditure" },
  { value: "repairs", label: "Repairs" },
  { value: "other", label: "Other" },
];

const defaultExpenses = (): OperatingExpense[] =>
  (
    [
      ["expense-taxes", "taxes", "Property taxes"],
      ["expense-insurance", "insurance", "Home / landlord insurance"],
      ["expense-gas", "utilities", "Gas"],
      ["expense-electric", "utilities", "Electric"],
      ["expense-water", "utilities", "Water"],
      ["expense-sewer", "utilities", "Sewer"],
      ["expense-hoa", "hoa", "HOA / fixed fees"],
      ["expense-management", "management", "Property management"],
      ["expense-maintenance", "maintenance", "Maintenance reserve"],
      ["expense-capex", "capital", "Capital expenditure reserve"],
      ["expense-repairs", "repairs", "Repairs"],
      ["expense-other", "other", "Other operating expense"],
    ] satisfies Array<[string, ExpenseCategory, string]>
  ).map(([id, category, name]) => ({
    id,
    name,
    monthlyAmount: 0,
    category: category as ExpenseCategory,
  }));

export const createFundingSource = (id = "funding-1", name = "Cash"): FundingSource => ({
  id,
  name,
  provider: "",
  productId: "",
  subtype: "personal_cash",
  accountNickname: "",
  lastFour: "",
  amount: 0,
  ratePercent: 0,
  introRatePercent: 0,
  introMonths: 0,
  termMonths: 0,
  amortizationMonths: 0,
  minimumPaymentPercent: 2,
  minimumPaymentAmount: 25,
  annualFee: 0,
  upfrontFee: 0,
  type: "cash",
  allocation: "down_payment",
  repayment: "none",
  useIntroRate: false,
  confirmed: false,
});

export const createDefaultDealInputs = (): DealInputs => ({
  strategy: "buy_hold",
  purchaseFinancing: "mortgage",
  propertyType: "single_family",
  units: 1,
  purchasePrice: 0,
  assessorValue: 0,
  asIsValue: 0,
  afterRepairValue: 0,
  lenderAppraisedValue: 0,
  rehabBudget: 0,
  downPayment: 0,
  closingCostPercent: 5,
  closingCosts: 0,
  appraisalFee: 0,
  inspectionFee: 0,
  loanPoints: 0,
  loanAmount: 0,
  interestRatePercent: 7,
  loanTermYears: 30,
  amortizationYears: 30,
  fundingSources: [createFundingSource()],
  operatingExpenses: defaultExpenses(),
  incomeUnits: [{ id: "unit-1", label: "Unit 1", monthlyRent: 0, occupied: true }],
  otherIncome: [{ id: "income-parking", name: "Parking / other income", monthlyAmount: 0 }],
  targetSalePrice: 0,
  sellingCostPercent: 8,
  holdingPeriodMonths: 6,
  refinanceEnabled: false,
  refinanceType: "rate_term",
  refinanceValueBasis: "lender",
  currentLoanBalance: 0,
  currentInterestRatePercent: 7,
  currentRemainingYears: 30,
  newLoanAmount: 0,
  newInterestRatePercent: 0,
  newLoanTermYears: 30,
  refinanceClosingCosts: 0,
  financeCredits: 0,
  cashOutAmount: 0,
  ltvLimitPercent: 75,
});
export const DEFAULT_DEAL_INPUTS: DealInputs = createDefaultDealInputs();

const finite = (value: unknown, fallback = 0) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const money = (value: unknown, fallback = 0) =>
  Math.min(100_000_000, Math.max(0, finite(value, fallback)));
const pct = (value: unknown, fallback = 0) => Math.min(100, Math.max(0, finite(value, fallback)));
const rate = (value: unknown, fallback = 0) => Math.min(50, Math.max(0, finite(value, fallback)));
const years = (value: unknown, fallback = 30) => Math.min(50, Math.max(1, finite(value, fallback)));
const cleanText = (value: unknown, fallback: string, limit = 80) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, limit) || fallback
    : fallback;
const cleanId = (value: unknown, fallback: string) =>
  cleanText(value, fallback, 96).replace(/[^a-zA-Z0-9:_-]/g, "-");

function legacyInputs(source: Record<string, unknown>) {
  const monthlyRent = money(source["monthlyRent"]),
    monthlyOtherIncome = money(source["monthlyOtherIncome"]);
  const expenses = defaultExpenses();
  const setExpense = (category: ExpenseCategory, amount: number) => {
    const row = expenses.find((item) => item.category === category);
    if (row) row.monthlyAmount = amount;
  };
  setExpense("taxes", money(source["annualPropertyTaxes"]) / 12);
  setExpense("insurance", money(source["annualInsurance"]) / 12);
  setExpense("hoa", money(source["monthlyHoa"]));
  const gross = monthlyRent + monthlyOtherIncome;
  setExpense("maintenance", (gross * pct(source["maintenancePercent"], 8)) / 100);
  setExpense("management", (gross * pct(source["managementPercent"], 8)) / 100);
  return {
    units: 1,
    downPayment: (money(source["purchasePrice"]) * pct(source["downPaymentPercent"], 20)) / 100,
    appraisalFee: 0,
    inspectionFee: 0,
    loanAmount: 0,
    amortizationYears: years(source["loanTermYears"], 30),
    fundingSources: createDefaultDealInputs().fundingSources,
    operatingExpenses: expenses,
    incomeUnits: [{ id: "unit-1", label: "Unit 1", monthlyRent, occupied: true }],
    otherIncome: [
      { id: "income-other", name: "Other monthly income", monthlyAmount: monthlyOtherIncome },
    ],
  };
}

export function normalizeDealInputs(value: unknown): DealInputs {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const defaults = createDefaultDealInputs();
  const legacy =
    !Array.isArray(source["incomeUnits"]) &&
    ("monthlyRent" in source || "downPaymentPercent" in source)
      ? legacyInputs(source)
      : {};
  const strategy = DEAL_STRATEGIES.some((item) => item.value === source["strategy"])
    ? (source["strategy"] as DealStrategy)
    : defaults.strategy;
  const purchaseFinancing = PURCHASE_FINANCING_OPTIONS.some(
    (item) => item.value === source["purchaseFinancing"],
  )
    ? (source["purchaseFinancing"] as PurchaseFinancing)
    : defaults.purchaseFinancing;
  const units = Math.min(
    200,
    Math.max(
      1,
      Math.round(finite(source["units"], finite((legacy as { units?: number }).units, 1))),
    ),
  );
  const propertyType = PROPERTY_TYPES.some((item) => item.value === source["propertyType"])
    ? (source["propertyType"] as PropertyType)
    : defaults.propertyType;
  const rawFunding = Array.isArray(source["fundingSources"])
    ? source["fundingSources"]
    : (legacy as { fundingSources?: unknown[] }).fundingSources;
  const fundingSources = (rawFunding?.slice(0, 24) ?? defaults.fundingSources).flatMap(
    (entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const legacyType = row["type"] === "credit" ? "line_of_credit" : row["type"];
      const type = FUNDING_SOURCE_TYPES.some((item) => item.value === legacyType)
        ? (legacyType as FundingSourceType)
        : "cash";
      const allocation = FUNDING_ALLOCATIONS.some((item) => item.value === row["allocation"])
        ? (row["allocation"] as FundingAllocation)
        : "closing_costs";
      const defaultRepayment: FundingRepayment =
        type === "cash" || type === "equity"
          ? "none"
          : type === "credit_card"
            ? "minimum_payment"
            : "interest_only";
      const repayment = FUNDING_REPAYMENT_OPTIONS.some((item) => item.value === row["repayment"])
        ? (row["repayment"] as FundingRepayment)
        : defaultRepayment;
      const allowedSubtypes = FUNDING_SUBTYPE_OPTIONS[type];
      const subtype = allowedSubtypes.some((option) => option.value === row["subtype"])
        ? String(row["subtype"])
        : allowedSubtypes[0]!.value;
      const lastFour =
        typeof row["lastFour"] === "string" ? row["lastFour"].replace(/\D/g, "").slice(-4) : "";
      return [
        {
          id: cleanId(row["id"], `funding-${index + 1}`),
          name: cleanText(row["name"], `Source ${index + 1}`),
          provider: cleanText(row["provider"], "", 80),
          productId: cleanId(row["productId"], ""),
          subtype,
          accountNickname: cleanText(row["accountNickname"], "", 40),
          lastFour,
          amount: money(row["amount"]),
          ratePercent: rate(row["ratePercent"] ?? row["rate"]),
          introRatePercent: rate(row["introRatePercent"]),
          introMonths: Math.min(120, Math.max(0, Math.round(finite(row["introMonths"])))),
          termMonths: Math.min(600, Math.max(0, Math.round(finite(row["termMonths"])))),
          amortizationMonths: Math.min(
            600,
            Math.max(0, Math.round(finite(row["amortizationMonths"], finite(row["termMonths"])))),
          ),
          minimumPaymentPercent: pct(row["minimumPaymentPercent"], 2),
          minimumPaymentAmount: money(row["minimumPaymentAmount"], 25),
          annualFee: money(row["annualFee"]),
          upfrontFee: money(row["upfrontFee"]),
          type,
          allocation,
          repayment: type === "cash" || type === "equity" ? "none" : repayment,
          useIntroRate: row["useIntroRate"] === true && finite(row["introMonths"]) > 0,
          confirmed: row["confirmed"] === true,
        },
      ];
    },
  );
  const rawExpenses = Array.isArray(source["operatingExpenses"])
    ? source["operatingExpenses"]
    : (legacy as { operatingExpenses?: unknown[] }).operatingExpenses;
  const operatingExpenses = (rawExpenses?.slice(0, 48) ?? defaults.operatingExpenses).flatMap(
    (entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      if (row["category"] === "vacancy" || row["id"] === "expense-vacancy") return [];
      const category = EXPENSE_CATEGORIES.some((item) => item.value === row["category"])
        ? (row["category"] as ExpenseCategory)
        : "other";
      return [
        {
          id: cleanId(row["id"], `expense-${index + 1}`),
          name: cleanText(row["name"], `Expense ${index + 1}`),
          monthlyAmount: money(row["monthlyAmount"] ?? finite(row["amount"]) / 12),
          category,
        },
      ];
    },
  );
  const rawUnits = Array.isArray(source["incomeUnits"])
    ? source["incomeUnits"]
    : (legacy as { incomeUnits?: unknown[] }).incomeUnits;
  const incomeUnits = (rawUnits?.slice(0, 200) ?? defaults.incomeUnits).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    return [
      {
        id: cleanId(row["id"], `unit-${index + 1}`),
        label: cleanText(row["label"] ?? row["unitLabel"], `Unit ${index + 1}`),
        monthlyRent: money(row["monthlyRent"] ?? row["rent"]),
        occupied: row["occupied"] !== false,
      },
    ];
  });
  while (incomeUnits.length < units)
    incomeUnits.push({
      id: `unit-${incomeUnits.length + 1}`,
      label: `Unit ${incomeUnits.length + 1}`,
      monthlyRent: 0,
      occupied: true,
    });
  incomeUnits.splice(units);
  const rawOther = Array.isArray(source["otherIncome"])
    ? source["otherIncome"]
    : (legacy as { otherIncome?: unknown[] }).otherIncome;
  const otherIncome = (rawOther?.slice(0, 24) ?? defaults.otherIncome).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    return [
      {
        id: cleanId(row["id"], `income-${index + 1}`),
        name: cleanText(row["name"], `Other income ${index + 1}`),
        monthlyAmount: money(row["monthlyAmount"]),
      },
    ];
  });
  const purchasePrice = money(source["purchasePrice"]);
  const storedClosingCosts = money(source["closingCosts"]);
  const inferredClosingPercent =
    purchasePrice > 0 && storedClosingCosts > 0 ? (storedClosingCosts / purchasePrice) * 100 : 5;
  const closingCostPercent = pct(source["closingCostPercent"], inferredClosingPercent);
  const closingCosts = (purchasePrice * closingCostPercent) / 100;
  const refinanceValueBasis = ["assessor", "as_is", "after_repair", "lender"].includes(
    String(source["refinanceValueBasis"]),
  )
    ? (source["refinanceValueBasis"] as RefinanceValueBasis)
    : "appraisalValue" in source
      ? "assessor"
      : defaults.refinanceValueBasis;
  return {
    strategy,
    purchaseFinancing,
    propertyType,
    units,
    purchasePrice,
    assessorValue: money(source["assessorValue"], finite(source["appraisalValue"])),
    asIsValue: money(source["asIsValue"]),
    afterRepairValue: money(source["afterRepairValue"]),
    lenderAppraisedValue: money(source["lenderAppraisedValue"]),
    rehabBudget: money(source["rehabBudget"]),
    downPayment:
      purchaseFinancing === "cash"
        ? purchasePrice
        : money(source["downPayment"], finite((legacy as { downPayment?: number }).downPayment)),
    closingCostPercent,
    closingCosts,
    appraisalFee: money(
      source["appraisalFee"],
      finite((legacy as { appraisalFee?: number }).appraisalFee),
    ),
    inspectionFee: money(
      source["inspectionFee"],
      finite((legacy as { inspectionFee?: number }).inspectionFee),
    ),
    loanPoints: money(source["loanPoints"]),
    loanAmount:
      purchaseFinancing === "cash"
        ? 0
        : money(source["loanAmount"], finite((legacy as { loanAmount?: number }).loanAmount)),
    interestRatePercent: rate(source["interestRatePercent"], 7),
    loanTermYears: years(source["loanTermYears"], 30),
    amortizationYears: years(
      source["amortizationYears"],
      finite((legacy as { amortizationYears?: number }).amortizationYears, 30),
    ),
    fundingSources: fundingSources.length ? fundingSources : defaults.fundingSources,
    operatingExpenses: operatingExpenses.length ? operatingExpenses : defaults.operatingExpenses,
    incomeUnits: incomeUnits.length ? incomeUnits : defaults.incomeUnits,
    otherIncome: otherIncome.length ? otherIncome : defaults.otherIncome,
    targetSalePrice: money(source["targetSalePrice"]),
    sellingCostPercent: pct(source["sellingCostPercent"], 8),
    holdingPeriodMonths: Math.min(
      120,
      Math.max(0, Math.round(finite(source["holdingPeriodMonths"], 6))),
    ),
    refinanceEnabled: source["refinanceEnabled"] === true,
    refinanceType: source["refinanceType"] === "cash_out" ? "cash_out" : "rate_term",
    refinanceValueBasis,
    currentLoanBalance: money(source["currentLoanBalance"]),
    currentInterestRatePercent: rate(
      source["currentInterestRatePercent"],
      finite(source["interestRatePercent"], 7),
    ),
    currentRemainingYears: years(
      source["currentRemainingYears"],
      finite(source["loanTermYears"], 30),
    ),
    newLoanAmount: money(source["newLoanAmount"]),
    newInterestRatePercent: rate(source["newInterestRatePercent"]),
    newLoanTermYears: years(source["newLoanTermYears"], 30),
    refinanceClosingCosts: money(source["refinanceClosingCosts"]),
    financeCredits: money(source["financeCredits"]),
    cashOutAmount: money(source["cashOutAmount"]),
    ltvLimitPercent: pct(source["ltvLimitPercent"], 75),
  };
}

export function normalizeDealTranscript(value: unknown): DealTranscriptEntry[] {
  if (!Array.isArray(value)) return [];
  const excluded = new Set([
    "fundingSources",
    "operatingExpenses",
    "incomeUnits",
    "otherIncome",
    "refinanceEnabled",
    "refinanceType",
    "refinanceValueBasis",
    "propertyType",
    "strategy",
    "purchaseFinancing",
  ]);
  const validFields = new Set(Object.keys(DEFAULT_DEAL_INPUTS).filter((key) => !excluded.has(key)));
  return value.slice(-100).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    const field =
      typeof source["field"] === "string" && validFields.has(source["field"])
        ? (source["field"] as DealVoiceField)
        : null;
    const transcript =
      typeof source["transcript"] === "string"
        ? source["transcript"].replace(/\s+/g, " ").trim().slice(0, 500)
        : "";
    const capturedAt =
      typeof source["capturedAt"] === "string" && !Number.isNaN(Date.parse(source["capturedAt"]))
        ? source["capturedAt"]
        : null;
    const valueNumber = source["value"] === null ? null : Number(source["value"]);
    if (
      !field ||
      !transcript ||
      !capturedAt ||
      (valueNumber !== null && !Number.isFinite(valueNumber))
    )
      return [];
    return [{ field, transcript, value: valueNumber, capturedAt }];
  });
}

export function monthlyPayment(
  principal: number,
  annualRatePercent: number,
  amortizationYears: number,
) {
  if (principal <= 0) return 0;
  const months = Math.max(1, Math.round(amortizationYears * 12)),
    monthlyRate = annualRatePercent / 100 / 12;
  if (!monthlyRate) return principal / months;
  return (
    (principal * monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1)
  );
}

export function fundingSourceMonthlyPayment(source: FundingSource, afterIntro = false) {
  if (
    source.amount <= 0 ||
    source.repayment === "none" ||
    source.type === "cash" ||
    source.type === "equity"
  )
    return 0;
  const ratePercent =
    !afterIntro && source.useIntroRate && source.introMonths > 0
      ? source.introRatePercent
      : source.ratePercent;
  const monthlyInterest = (source.amount * ratePercent) / 100 / 12;
  const monthlyFee = source.annualFee / 12;
  if (source.repayment === "interest_only") return monthlyInterest + monthlyFee;
  if (source.repayment === "amortizing") {
    const months = source.amortizationMonths || source.termMonths || 12;
    return monthlyPayment(source.amount, ratePercent, months / 12) + monthlyFee;
  }
  return (
    Math.max(
      (source.amount * source.minimumPaymentPercent) / 100,
      source.minimumPaymentAmount,
      monthlyInterest,
    ) + monthlyFee
  );
}

function selectedRefinanceValue(values: DealInputs) {
  if (values.refinanceValueBasis === "as_is") return values.asIsValue;
  if (values.refinanceValueBasis === "after_repair") return values.afterRepairValue;
  if (values.refinanceValueBasis === "lender") return values.lenderAppraisedValue;
  return values.assessorValue;
}

function gradeLetter(score: number): DealResults["dealGrade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function buildDealGrade(
  values: DealInputs,
  result: Pick<
    DealResults,
    | "complete"
    | "fundingGap"
    | "cashToClose"
    | "dscr"
    | "cashOnCashPercent"
    | "monthlyCashFlow"
    | "monthlyGrossIncome"
    | "allInCost"
    | "projectedSalePrice"
    | "projectedProfit"
    | "projectedMarginPercent"
  >,
) {
  if (!result.complete || values.strategy === "owner_occupied")
    return { score: null, grade: null, factors: [] as DealResults["gradeFactors"] };
  const factors: DealResults["gradeFactors"] = [];
  const readinessRatio =
    result.cashToClose > 0 ? Math.max(0, 1 - result.fundingGap / result.cashToClose) : 1;
  factors.push({
    label: "Funding readiness",
    points: Math.round(readinessRatio * 20),
    possible: 20,
    explanation:
      result.fundingGap > 0
        ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(result.fundingGap)} remains uncovered.`
        : "The modeled cash requirement is covered.",
  });

  const referenceValue =
    values.strategy === "fix_flip" || values.strategy === "brrrr"
      ? values.afterRepairValue
      : values.asIsValue || values.lenderAppraisedValue || values.assessorValue;
  const valueCushion =
    referenceValue > 0 ? ((referenceValue - result.allInCost) / referenceValue) * 100 : null;
  const valuePoints =
    valueCushion === null
      ? 0
      : valueCushion >= 25
        ? 20
        : valueCushion >= 15
          ? 15
          : valueCushion >= 5
            ? 10
            : valueCushion > 0
              ? 5
              : 0;
  factors.push({
    label: "Value cushion",
    points: valuePoints,
    possible: 20,
    explanation:
      valueCushion === null
        ? "Add an as-is or after-repair value to score the cost-to-value cushion."
        : `${valueCushion.toFixed(1)}% separates the selected value from the all-in basis.`,
  });

  const incomeStrategy = values.strategy === "buy_hold" || values.strategy === "brrrr";
  if (incomeStrategy) {
    const coveragePoints =
      result.dscr === null
        ? 0
        : result.dscr >= 1.5
          ? 25
          : result.dscr >= 1.25
            ? 20
            : result.dscr >= 1
              ? 12
              : 0;
    factors.push({
      label: "Income coverage",
      points: coveragePoints,
      possible: 25,
      explanation:
        result.dscr === null
          ? "No debt coverage ratio is available."
          : `The modeled DSCR is ${result.dscr.toFixed(2)}×.`,
    });
    const returnPoints =
      result.cashOnCashPercent === null
        ? 0
        : result.cashOnCashPercent >= 12
          ? 25
          : result.cashOnCashPercent >= 8
            ? 20
            : result.cashOnCashPercent >= 5
              ? 12
              : result.cashOnCashPercent > 0
                ? 6
                : 0;
    factors.push({
      label: "Cash return",
      points: returnPoints,
      possible: 25,
      explanation:
        result.cashOnCashPercent === null
          ? "No cash-on-cash return is available."
          : `The modeled cash-on-cash return is ${result.cashOnCashPercent.toFixed(1)}%.`,
    });
  } else {
    const marginPoints =
      result.projectedMarginPercent === null
        ? 0
        : result.projectedMarginPercent >= 20
          ? 50
          : result.projectedMarginPercent >= 12
            ? 38
            : result.projectedMarginPercent >= 5
              ? 24
              : result.projectedMarginPercent > 0
                ? 12
                : 0;
    factors.push({
      label: "Projected disposition margin",
      points: marginPoints,
      possible: 50,
      explanation:
        result.projectedMarginPercent === null
          ? "Add the applicable disposition value to score the projected margin."
          : `The modeled disposition margin is ${result.projectedMarginPercent.toFixed(1)}%.`,
    });
  }

  const hasOperatingEvidence = values.operatingExpenses.some(
    (expense) => expense.monthlyAmount > 0,
  );
  const dataPoints =
    (referenceValue > 0 ? 5 : 0) +
    (incomeStrategy ? (hasOperatingEvidence ? 5 : 0) : result.projectedSalePrice > 0 ? 5 : 0);
  factors.push({
    label: "Assumption readiness",
    points: dataPoints,
    possible: 10,
    explanation:
      dataPoints === 10
        ? "The main value and cost assumptions are populated."
        : "One or more value, income, or expense assumptions still need evidence.",
  });
  const score = Math.max(
    0,
    Math.min(
      100,
      factors.reduce((sum, factor) => sum + factor.points, 0),
    ),
  );
  return { score, grade: gradeLetter(score), factors };
}

export function calculateDeal(input: DealInputs): DealResults {
  const values = normalizeDealInputs(input),
    missingInputs: string[] = [];
  if (!values.purchasePrice) missingInputs.push("purchase price");
  if (
    (values.strategy === "buy_hold" || values.strategy === "brrrr") &&
    !values.incomeUnits.some((unit) => unit.monthlyRent > 0)
  )
    missingInputs.push("rent for at least one unit");
  if ((values.strategy === "brrrr" || values.strategy === "fix_flip") && !values.afterRepairValue)
    missingInputs.push("after-repair value");
  if (
    (values.strategy === "wholesale" || values.strategy === "vacant_land") &&
    !values.targetSalePrice
  )
    missingInputs.push("target disposition price");
  const confirmedFunding = values.fundingSources.filter((source) => source.confirmed);
  const fundingUpfrontFees = confirmedFunding.reduce((sum, source) => sum + source.upfrontFee, 0);
  const allInCost =
    values.purchasePrice +
    values.rehabBudget +
    values.closingCosts +
    values.appraisalFee +
    values.inspectionFee +
    values.loanPoints +
    fundingUpfrontFees;
  const purchaseCashRequirement =
    values.purchaseFinancing === "cash" ? values.purchasePrice : values.downPayment;
  const cashToClose =
    purchaseCashRequirement +
    values.rehabBudget +
    values.closingCosts +
    values.appraisalFee +
    values.inspectionFee +
    values.loanPoints +
    fundingUpfrontFees;
  const loanAmount =
    values.purchaseFinancing === "cash"
      ? 0
      : values.loanAmount || Math.max(0, values.purchasePrice - values.downPayment);
  const fundingTotal = confirmedFunding.reduce((sum, source) => sum + source.amount, 0),
    fundingGap = Math.max(cashToClose - fundingTotal, 0);
  const fundingCarryMonthly = confirmedFunding.reduce(
    (sum, source) => sum + fundingSourceMonthlyPayment(source),
    0,
  );
  const fundingPaymentAfterIntroMonthly = confirmedFunding.reduce(
    (sum, source) => sum + fundingSourceMonthlyPayment(source, true),
    0,
  );
  const confirmedCash = confirmedFunding
    .filter((source) => source.type === "cash" || source.type === "equity")
    .reduce((sum, source) => sum + source.amount, 0);
  const confirmedDebtFunding = fundingTotal - confirmedCash;
  const requiredCashAfterDebt = Math.max(0, cashToClose - confirmedDebtFunding);
  const cashInvested = confirmedFunding.length
    ? Math.min(confirmedCash, requiredCashAfterDebt) + fundingGap
    : cashToClose;
  const monthlyDebtService = monthlyPayment(
    loanAmount,
    values.interestRatePercent,
    values.amortizationYears,
  );
  const monthlyGrossRent = values.incomeUnits.reduce(
    (sum, unit) => sum + (unit.occupied ? unit.monthlyRent : 0),
    0,
  );
  const monthlyOtherIncome = values.otherIncome.reduce((sum, item) => sum + item.monthlyAmount, 0),
    monthlyGrossIncome = monthlyGrossRent + monthlyOtherIncome;
  const monthlyOperatingExpenses = values.operatingExpenses.reduce(
      (sum, expense) => sum + expense.monthlyAmount,
      0,
    ),
    monthlyNoi = monthlyGrossIncome - monthlyOperatingExpenses,
    annualNoi = monthlyNoi * 12;
  const annualDebtService = (monthlyDebtService + fundingCarryMonthly) * 12,
    monthlyCashFlow = monthlyNoi - monthlyDebtService - fundingCarryMonthly,
    annualCashFlow = monthlyCashFlow * 12;
  const basis = values.purchasePrice + values.rehabBudget,
    capRatePercent = basis > 0 ? (annualNoi / basis) * 100 : null;
  const cashOnCashPercent = cashInvested > 0 ? (annualCashFlow / cashInvested) * 100 : null,
    dscr = annualDebtService > 0 ? annualNoi / annualDebtService : null;
  const minimumMonthlyRent = Math.max(
      0,
      monthlyOperatingExpenses + monthlyDebtService + fundingCarryMonthly - monthlyOtherIncome,
    ),
    occupiedUnits = values.incomeUnits.filter((unit) => unit.occupied).length;
  const projectedSalePrice =
    values.strategy === "fix_flip" ? values.afterRepairValue : values.targetSalePrice;
  const projectedSellingCosts = (projectedSalePrice * values.sellingCostPercent) / 100;
  const projectedHoldingCosts =
    (monthlyOperatingExpenses + monthlyDebtService + fundingCarryMonthly) *
    values.holdingPeriodMonths;
  const projectedProfit =
    projectedSalePrice > 0
      ? values.strategy === "wholesale"
        ? projectedSalePrice - values.purchasePrice - values.closingCosts - projectedHoldingCosts
        : projectedSalePrice - allInCost - projectedSellingCosts - projectedHoldingCosts
      : null;
  const projectedMarginPercent =
    projectedProfit !== null && projectedSalePrice > 0
      ? (projectedProfit / projectedSalePrice) * 100
      : null;
  const currentBalance = values.currentLoanBalance || loanAmount,
    currentRate = values.currentInterestRatePercent || values.interestRatePercent;
  const currentMonthlyPayment = monthlyPayment(
      currentBalance,
      currentRate,
      values.currentRemainingYears,
    ),
    newMonthlyPayment = monthlyPayment(
      values.newLoanAmount,
      values.newInterestRatePercent,
      values.newLoanTermYears,
    );
  const refinanceMonthlySavings = currentMonthlyPayment - newMonthlyPayment,
    refinanceProceeds =
      values.newLoanAmount - currentBalance - values.refinanceClosingCosts + values.financeCredits,
    refinanceNet = refinanceProceeds - values.cashOutAmount;
  const refinanceBreakEvenMonths =
    values.refinanceEnabled && refinanceMonthlySavings > 0
      ? Math.ceil(
          Math.max(values.refinanceClosingCosts - values.financeCredits, 0) /
            refinanceMonthlySavings,
        )
      : null;
  const refinanceValue = selectedRefinanceValue(values);
  const refinanceLtvPercent =
      refinanceValue > 0 ? (values.newLoanAmount / refinanceValue) * 100 : null,
    maxAllowedLoan = (refinanceValue * values.ltvLimitPercent) / 100,
    exceedsLtv =
      values.refinanceEnabled && refinanceValue > 0 && values.newLoanAmount > maxAllowedLoan;
  const complete = missingInputs.length === 0;
  const grade = buildDealGrade(values, {
    complete,
    fundingGap,
    cashToClose,
    dscr,
    cashOnCashPercent,
    monthlyCashFlow,
    monthlyGrossIncome,
    allInCost,
    projectedSalePrice,
    projectedProfit,
    projectedMarginPercent,
  });
  const signals: DealResults["signals"] = [];
  if (missingInputs.length)
    signals.push({
      level: "unknown",
      text: `Add ${missingInputs.join(" and ")} to complete the projection.`,
    });
  if (!missingInputs.length) {
    signals.push(
      monthlyCashFlow > 0
        ? {
            level: "positive",
            text: "Projected monthly cash flow is positive before income taxes and unmodeled costs.",
          }
        : monthlyCashFlow < 0
          ? {
              level: "attention",
              text: "Projected monthly cash flow is negative before income taxes and unmodeled costs.",
            }
          : {
              level: "unknown",
              text: "Projected monthly cash flow is exactly break-even before income taxes and unmodeled costs.",
            },
    );
    if (dscr !== null)
      signals.push(
        dscr >= 1.2
          ? {
              level: "positive",
              text: "Projected DSCR is at least 1.20, a commonly reviewed lending cushion.",
            }
          : {
              level: "attention",
              text: "Projected DSCR is below 1.20; debt coverage may be thin.",
            },
      );
  }
  if (exceedsLtv)
    signals.push({
      level: "attention",
      text: "The proposed refinance exceeds the selected LTV limit.",
    });
  if (fundingPaymentAfterIntroMonthly > fundingCarryMonthly)
    signals.push({
      level: "attention",
      text: `Funding payments increase after introductory terms end; the modeled post-intro payment is ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(fundingPaymentAfterIntroMonthly)} per month.`,
    });
  signals.push({
    level: "unknown",
    text: "Ownership and clear title are not established by this calculator or the currently available property records.",
  });
  return {
    calculationVersion: DEAL_CALCULATION_VERSION,
    complete,
    missingInputs,
    allInCost,
    cashToClose,
    loanAmount,
    cashInvested,
    fundingTotal,
    fundingGap,
    fundingCarryMonthly,
    fundingPaymentAfterIntroMonthly,
    monthlyDebtService,
    annualDebtService,
    monthlyGrossRent,
    monthlyOtherIncome,
    monthlyGrossIncome,
    monthlyOperatingExpenses,
    monthlyNoi,
    annualNoi,
    monthlyCashFlow,
    annualCashFlow,
    capRatePercent,
    cashOnCashPercent,
    dscr,
    minimumMonthlyRent,
    occupiedUnits,
    currentMonthlyPayment,
    newMonthlyPayment,
    refinanceMonthlySavings,
    refinanceProceeds,
    refinanceNet,
    refinanceBreakEvenMonths,
    refinanceLtvPercent,
    maxAllowedLoan,
    exceedsLtv,
    refinanceValue,
    projectedSalePrice,
    projectedSellingCosts,
    projectedHoldingCosts,
    projectedProfit,
    projectedMarginPercent,
    dealScore: grade.score,
    dealGrade: grade.grade,
    gradeFactors: grade.factors,
    signals,
    explanation: missingInputs.length
      ? `This scenario is not complete. Add ${missingInputs.join(" and ")} before relying on the return metrics.`
      : "Accountabul used the saved acquisition, funding, income, expense and financing assumptions. Cash has no repayment terms; financed sources use their selected repayment method. The result is a projection, not an appraisal, title opinion, inspection or lending commitment.",
  };
}

const smallNumbers: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
export function parseSpokenNumber(transcript: string): number | null {
  const cleaned = transcript
      .toLowerCase()
      .replace(/[$,%]/g, "")
      .replace(/,/g, "")
      .replace(/-/g, " ")
      .trim(),
    direct = Number(cleaned.replace(/\s+/g, ""));
  if (Number.isFinite(direct)) return direct;
  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token !== "dollars" && token !== "dollar" && token !== "percent");
  let total = 0,
    section = 0,
    decimal = "";
  let afterPoint = false,
    recognized = false;
  for (const token of tokens) {
    if (token === "and") continue;
    if (token === "point") {
      afterPoint = true;
      continue;
    }
    const small = smallNumbers[token];
    if (small !== undefined) {
      recognized = true;
      if (afterPoint) decimal += String(small);
      else section += small;
      continue;
    }
    if (token === "hundred") {
      section = Math.max(1, section) * 100;
      recognized = true;
      continue;
    }
    if (token === "thousand" || token === "million") {
      total += Math.max(1, section) * (token === "thousand" ? 1_000 : 1_000_000);
      section = 0;
      recognized = true;
      continue;
    }
    return null;
  }
  return recognized ? total + section + (decimal ? Number(`0.${decimal}`) : 0) : null;
}
