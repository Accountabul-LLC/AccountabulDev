// PDF rendering for the Property Intelligence report (Phase 4 of
// docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). Scoped to the real data that
// exists here: the Assessor parcel profile (property_intel_profiles), the
// caller's verified owner records (property_owner_documents where status =
// 'verified'), and their most recent Deal Analyst scenario for the parcel.
// Nothing is invented -- a section is omitted or marked "not entered" when
// there is no real data for it.
//
// Layout follows the "Deal eval final PDF" reference design (navy cover
// band, KPI cards, two-column label/value tables, running header/footer).
// Property Insight's Design Studio profile is still `unbranded`, so these
// colors are a proposal, not an approved identity.
//
// pdf-lib is not installable in the cloud session (see AGENTS.md), so no
// test imports this module; build-runner exercises it locally.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

import type { ReportSnapshotPayload } from "./report-vault-validation.ts";

const hex = (value: string) =>
  rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  );

const NAVY = hex("#0F2A44");
const GOLD = hex("#B8902F");
const INK = hex("#1F2933");
const MUTED = hex("#6B7785");
const LINE = hex("#D9DEE4");
const TINT = hex("#F4F6F8");
const RED = hex("#B42318");
const GREEN = hex("#1E7B4A");
const MIST = hex("#C9D3DE");
const WHITE = rgb(1, 1, 1);

const W = 612; // US Letter, points
const H = 792;
const M = 50.4; // 0.7in
const CW = W - 2 * M;
const BAND = 111.6; // 1.55in cover band
const TOP_FIRST = H - BAND - 22;
const TOP = H - 54;
const BOTTOM = 58;

const NE = "—"; // not entered

type Row = [string, string];
type Fonts = { regular: PDFFont; bold: PDFFont };

// WinAnsi (the standard fonts' encoding) can draw these; everything else
// would throw inside pdf-lib, so it is normalised or dropped.
function safe(value: unknown): string {
  return String(value ?? "")
    .replace(/[‐‑‒―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E—–•×]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of safe(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function money(value: unknown, decimals = 0): string {
  const n = num(value);
  if (n === null) return NE;
  const text = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${n < 0 ? "–" : ""}$${text}`;
}

/** Optional inputs where 0 means the user left the field blank. */
const entered = (value: unknown, decimals = 0) => (num(value) ? money(value, decimals) : NE);

const pct = (value: unknown, decimals = 1) => {
  const n = num(value);
  return n === null ? NE : `${n.toFixed(decimals)}%`;
};

function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not reported";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-US");
  return safe(value);
}

const label = (value: unknown) =>
  safe(value)
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

const STRATEGY: Record<string, string> = {
  buy_hold: "Buy & hold",
  brrrr: "BRRRR",
  fix_flip: "Fix & flip",
  wholesale: "Wholesale",
  vacant_land: "Vacant land",
  owner_occupied: "Owner occupied",
};

const VALUE_BASIS: Record<string, string> = {
  assessor: "Assessor value",
  as_is: "As-is value",
  after_repair: "After-repair value",
  lender: "Lender appraisal",
};

class Layout {
  page!: PDFPage;
  y = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly f: Fonts,
  ) {
    this.page = doc.addPage([W, H]);
    this.y = TOP_FIRST;
  }

  ensure(height: number) {
    if (this.y - height < BOTTOM) {
      this.page = this.doc.addPage([W, H]);
      this.y = TOP;
    }
  }

  draw(t: string, x: number, y: number, size: number, font: PDFFont, color: RGB) {
    this.page.drawText(safe(t), { x, y, size, font, color });
  }

  drawRight(t: string, right: number, y: number, size: number, font: PDFFont, color: RGB) {
    const s = safe(t);
    this.page.drawText(s, { x: right - font.widthOfTextAtSize(s, size), y, size, font, color });
  }

  rule(y: number, x1 = M, x2 = W - M) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.5, color: LINE });
  }

  /** Section heading kept with at least `keep` points of what follows it. */
  section(title: string, subtitle?: string, keep = 60) {
    const subLines = subtitle ? wrap(subtitle, this.f.regular, 8.5, CW) : [];
    this.ensure(36 + subLines.length * 11 + keep);
    this.y -= 16 + 12.5;
    this.draw(title, M, this.y, 12.5, this.f.bold, NAVY);
    this.y -= 6;
    for (const line of subLines) {
      this.y -= 11;
      this.draw(line, M, this.y, 8.5, this.f.regular, MUTED);
    }
    this.y -= 10;
  }

  paragraph(t: string, size = 8.5, color = MUTED) {
    const lines = wrap(t, this.f.regular, size, CW);
    this.ensure(lines.length * 12);
    for (const line of lines) {
      this.y -= 12;
      this.draw(line, M, this.y + 3, size, this.f.regular, color);
    }
  }

  cards(items: Array<[string, string, (RGB | undefined)?]>) {
    const gap = 6;
    const w = (CW - gap * (items.length - 1)) / items.length;
    const h = 52;
    this.ensure(h + 4);
    const top = this.y;
    items.forEach(([value, caption, color], i) => {
      const x = M + i * (w + gap);
      this.page.drawRectangle({ x, y: top - h, width: w, height: h, color: TINT });
      this.page.drawRectangle({ x, y: top - 2, width: w, height: 2, color: NAVY });
      this.draw(value, x + 8, top - 25, 15, this.f.bold, color ?? NAVY);
      const lines = wrap(caption.toUpperCase(), this.f.regular, 7.5, w - 16);
      lines.forEach((line, n) =>
        this.draw(line, x + 8, top - 38 - n * 9, 7.5, this.f.regular, MUTED),
      );
    });
    this.y = top - h - 4;
  }

  /** Label/value pairs split into two side-by-side columns, kept together. */
  pairs(subtitle: string, rows: Row[]) {
    if (!rows.length) return;
    const per = Math.ceil(rows.length / 2);
    const rowH = 18;
    this.ensure(22 + per * rowH);
    this.y -= 9 + 9;
    this.draw(subtitle, M, this.y, 9, this.f.bold, GOLD);
    this.y -= 5;
    const gap = 21.6;
    const pw = (CW - gap) / 2;
    for (let r = 0; r < per; r++) {
      const base = this.y - rowH;
      for (let c = 0; c < 2; c++) {
        const row = rows[c * per + r];
        if (!row) continue;
        const x = M + c * (pw + gap);
        this.draw(row[0], x, base + 6, 9, this.f.regular, MUTED);
        this.drawRight(row[1], x + pw, base + 6, 9, this.f.bold, INK);
        this.rule(base, x, x + pw);
      }
      this.y = base;
    }
  }

  /** Full-width rows for long values such as the legal description. */
  wide(rows: Row[]) {
    const lw = CW * 0.3;
    for (const [l, v] of rows) {
      const lines = wrap(v, this.f.bold, 9, CW - lw);
      const h = lines.length * 12 + 8;
      this.ensure(h);
      this.draw(l, M, this.y - 13, 9, this.f.regular, MUTED);
      lines.forEach((line, n) =>
        this.draw(line, M + lw, this.y - 13 - n * 12, 9, this.f.bold, INK),
      );
      this.y -= h;
      this.rule(this.y);
    }
  }
}

function drawChrome(
  doc: PDFDocument,
  f: Fonts,
  meta: { address: string; parcel: string; date: string; reportId: string; locality: string },
) {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const l = { page } as Layout;
    const draw = Layout.prototype.draw.bind(l);
    const drawRight = Layout.prototype.drawRight.bind(l);
    const line = (y: number) =>
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });

    if (index === 0) {
      page.drawRectangle({ x: 0, y: H - BAND, width: W, height: BAND, color: NAVY });
      page.drawRectangle({ x: 0, y: H - BAND, width: W, height: 3, color: GOLD });
      draw("ACCOUNTABUL", M, H - 36, 11, f.bold, WHITE);
      drawRight("PROPERTY REPORT", W - M, H - 36, 8, f.regular, MIST);
      const title = wrap(meta.address, f.bold, 22, CW - 170)[0] ?? "";
      draw(title, M, H - 68.4, 22, f.bold, WHITE);
      const parcel = meta.parcel ? `   •   Parcel ID ${meta.parcel}` : "";
      draw(`${meta.locality}${parcel}`, M, H - 86.4, 9.5, f.regular, MIST);
      drawRight(`Report date: ${meta.date}`, W - M, H - 68.4, 8, f.regular, MIST);
      drawRight(`Report ID: ${meta.reportId}`, W - M, H - 80.6, 8, f.regular, MIST);
    } else {
      draw("ACCOUNTABUL  |  Property Report", M, H - 32.4, 8, f.bold, NAVY);
      const right = meta.parcel ? `${meta.address}  •  Parcel ${meta.parcel}` : meta.address;
      drawRight(right, W - M, H - 32.4, 8, f.regular, MUTED);
      line(H - 37.4);
    }
    line(44.6);
    draw(`Report ID ${meta.reportId}  •  Generated ${meta.date}`, M, 32.4, 7.5, f.regular, MUTED);
    drawRight(`Page ${index + 1} of ${pages.length}`, W - M, 32.4, 7.5, f.regular, MUTED);
  });
}

function drawSummary(
  l: Layout,
  profile: Record<string, unknown> | null,
  deal: ReportSnapshotPayload["deal"],
) {
  const r = deal?.results ?? {};
  const items: Array<[string, string, (RGB | undefined)?]> = [];
  if (profile) items.push([money(profile["assessed_total_value"]), "Assessed total value"]);
  if (deal) {
    const flow = num(r["monthlyCashFlow"]);
    items.push([
      flow === null ? NE : `${money(flow)} / mo`,
      "Projected cash flow",
      flow === null ? undefined : flow >= 0 ? GREEN : RED,
    ]);
    const dscr = num(r["dscr"]);
    items.push([dscr === null ? NE : `${dscr.toFixed(2)}×`, "Debt service coverage"]);
    const score = num(r["dealScore"]);
    const grade = r["dealGrade"];
    const gradeColor = grade === "A" || grade === "B" ? GREEN : grade === "C" ? undefined : RED;
    items.push([
      score === null ? NE : `${Math.round(score)} / 100`,
      grade ? `Deal score • Grade ${safe(grade)}` : "Deal score",
      score === null ? undefined : gradeColor,
    ]);
  }
  if (!items.length) return;
  l.section(
    "Summary",
    "Key figures from the official assessor record and the saved deal scenario.",
  );
  l.cards(items);
}

function drawAssessor(l: Layout, profile: Record<string, unknown> | null) {
  l.section(
    "Official Assessor Record",
    "Source: City of St. Louis Assessor. Reproduced as published; not modified by Accountabul.",
  );
  if (!profile) {
    l.paragraph("No Assessor profile is on file for this parcel yet.");
    return;
  }
  const p = (key: string) => profile[key];
  l.wide([
    ["Owner of record", text(p("owner_name"))],
    ["Legal description", text(p("legal_description"))],
  ]);
  const lot = num(p("lot_square_feet"));
  l.pairs("Property characteristics", [
    ["Land use code", text(p("land_use_code"))],
    ["Zoning district", text(p("zoning"))],
    ["Ward", text(p("ward"))],
    ["Lot size", lot === null ? "Not reported" : `${lot.toLocaleString("en-US")} sq ft`],
    ["Year built", p("first_year_built") ? String(p("first_year_built")) : "Not reported"],
    ["Number of units", text(p("number_of_units"))],
    ["Vacant lot", text(p("vacant_lot"))],
    ["Owner occupied", text(p("owner_occupied"))],
  ]);
  l.pairs("Assessment & taxes", [
    ["Assessed land value", money(p("assessed_land_value"))],
    ["Assessed improvement value", money(p("assessed_improvement_value"))],
    ["Assessed total value", money(p("assessed_total_value"))],
    ["Prior tax amount", money(p("prior_tax_amount"))],
    ["Tax balance", num(p("tax_balance")) === null ? "Not reported" : money(p("tax_balance"))],
    ["Tax abatement", text(p("is_tax_abated"))],
  ]);
}

function drawDeal(l: Layout, deal: NonNullable<ReportSnapshotPayload["deal"]>) {
  const i = deal.inputs;
  const r = deal.results;
  l.section(
    "Deal Analysis",
    `${STRATEGY[String(i["strategy"])] ?? "Deal"} scenario saved by the account holder. Figures are projections based on user-entered assumptions, not an appraisal. ${NE} indicates a value was not entered.`,
    70,
  );
  l.cards([
    [money(r["annualCashFlow"]), "Annual cash flow"],
    [pct(r["capRatePercent"]), "Cap rate"],
    [pct(r["cashOnCashPercent"]), "Cash-on-cash return"],
    [money(r["cashToClose"]), "Cash to close"],
  ]);

  const units = num(i["units"]);
  const occupied = num(r["occupiedUnits"]);
  const holding = num(i["holdingPeriodMonths"]);
  l.pairs("Scenario overview", [
    ["Strategy", STRATEGY[String(i["strategy"])] ?? label(i["strategy"])],
    ["Property type", label(i["propertyType"])],
    [
      "Units",
      units === null ? NE : `${units}${occupied === null ? "" : ` (${occupied} occupied)`}`,
    ],
    ["Holding period", holding ? `${holding} months` : NE],
  ]);

  l.pairs("Acquisition", [
    ["Purchase price", money(i["purchasePrice"])],
    [`Closing costs (${num(i["closingCostPercent"]) ?? 0}%)`, money(i["closingCosts"])],
    ["Rehab budget", entered(i["rehabBudget"])],
    ["Inspection fee", entered(i["inspectionFee"])],
    ["Appraisal fee", entered(i["appraisalFee"])],
    ["As-is value", entered(i["asIsValue"])],
    ["After-repair value", entered(i["afterRepairValue"])],
    ["All-in cost", money(r["allInCost"])],
  ]);

  const years = (v: unknown) => (num(v) ? `${num(v)} years` : NE);
  l.pairs("Financing", [
    ["Financing type", label(i["purchaseFinancing"])],
    ["Loan amount", money(r["loanAmount"])],
    ["Down payment", money(i["downPayment"])],
    ["Interest rate", pct(i["interestRatePercent"], 2)],
    ["Loan term", years(i["loanTermYears"])],
    ["Amortization", years(i["amortizationYears"])],
    ["Loan points", text(i["loanPoints"] ?? 0)],
    ["Monthly payment", money(r["monthlyDebtService"], 2)],
    ["Annual debt service", money(r["annualDebtService"], 2)],
    ["LTV limit", pct(i["ltvLimitPercent"], 0)],
    ["Exceeds LTV limit", r["exceedsLtv"] ? "Yes" : "No"],
    ["Funding gap", money(r["fundingGap"])],
  ]);

  l.pairs("Income & operating", [
    ["Monthly gross rent", money(r["monthlyGrossRent"], 2)],
    ["Other monthly income", money(r["monthlyOtherIncome"], 2)],
    ["Monthly operating expenses", money(r["monthlyOperatingExpenses"], 2)],
    ["Monthly NOI", money(r["monthlyNoi"], 2)],
    ["Annual NOI", money(r["annualNoi"], 2)],
    ["Break-even monthly rent", money(r["minimumMonthlyRent"], 2)],
  ]);

  if (i["refinanceEnabled"]) {
    const type = i["refinanceType"] === "cash_out" ? "Cash-out" : "Rate & term";
    l.pairs("Refinance", [
      ["Refinance", `Enabled • ${type}`],
      [
        "Value basis",
        VALUE_BASIS[String(i["refinanceValueBasis"])] ?? label(i["refinanceValueBasis"]),
      ],
      ["Lender appraised value", entered(i["lenderAppraisedValue"])],
      ["Max allowed loan", money(r["maxAllowedLoan"])],
      ["New loan amount", money(i["newLoanAmount"])],
      [
        "New rate / term",
        `${pct(i["newInterestRatePercent"], 2)} / ${years(i["newLoanTermYears"])}`,
      ],
      ["Refinance closing costs", money(i["refinanceClosingCosts"])],
      ["Net refinance proceeds", money(r["refinanceNet"])],
      ["Monthly savings", money(r["refinanceMonthlySavings"])],
    ]);
  }

  l.pairs("Holding & exit", [
    ["Projected holding costs", money(r["projectedHoldingCosts"], 2)],
    ["Selling costs", `${num(i["sellingCostPercent"]) ?? 0}% of sale price`],
    ["Target sale price", entered(i["targetSalePrice"])],
    ["Projected sale price", entered(r["projectedSalePrice"])],
  ]);
}

function drawOwnerRecords(
  l: Layout,
  records: ReportSnapshotPayload["property"]["verifiedOwnerRecords"],
) {
  l.section("Verified Owner Records", undefined, 20);
  if (!records.length) {
    l.paragraph(
      "No Accountabul-verified owner records have been added to this workspace for this property.",
    );
    return;
  }
  l.wide(
    records.map((record) => {
      const meta = [
        record.occurredAt,
        record.amount !== null ? money(record.amount, 2) : null,
        record.vendorName,
      ]
        .filter(Boolean)
        .join("  •  ");
      return [label(record.category), meta ? `${record.title} — ${meta}` : record.title];
    }),
  );
}

function drawDisclosures(l: Layout) {
  l.section("Sources & Disclosures", undefined, 40);
  for (const t of [
    "Assessor data is sourced from the City of St. Louis Assessor and is presented as published. Accountabul does not guarantee its accuracy or completeness; verify with the Assessor's Office before relying on it.",
    "Deal analysis is generated from assumptions entered by the account holder (acquisition, financing, income, expense and refinance inputs). Results are estimates for planning purposes and are not an appraisal, loan commitment, or investment, tax, or legal advice.",
    "Verified owner records are documents submitted by the owner and reviewed by Accountabul. Owner-submitted records are shown only after verification.",
  ]) {
    l.paragraph(t);
    l.y -= 5;
  }
}

/**
 * Renders a Property Intelligence report PDF from a snapshot payload. Pure
 * function of its input: identical payloads always render identical bytes,
 * which is what lets report-vault.server.ts's content-hash dedup guarantee
 * the stored PDF and its hash never diverge from the snapshot that produced
 * them.
 */
export async function buildReportPdf(snapshot: ReportSnapshotPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const address = safe(snapshot.workspace.address);
  const parcel = safe(snapshot.workspace.parcelId);
  const generated = new Date(snapshot.generatedAt);
  const date = generated.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const reportId = `ACB-${parcel || "UNRESOLVED"}-${snapshot.generatedAt.slice(0, 10).replace(/-/g, "")}`;

  doc.setTitle(`Accountabul Property Report — ${address}`);
  doc.setAuthor("Accountabul");
  doc.setProducer("Accountabul");
  // Fixed dates keep the output byte-identical for identical payloads.
  doc.setCreationDate(generated);
  doc.setModificationDate(generated);

  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const l = new Layout(doc, f);
  const profile = snapshot.property.profile;

  drawSummary(l, profile, snapshot.deal);
  drawAssessor(l, profile);
  if (snapshot.deal) drawDeal(l, snapshot.deal);
  drawOwnerRecords(l, snapshot.property.verifiedOwnerRecords);
  drawDisclosures(l);
  drawChrome(doc, f, { address, parcel, date, reportId, locality: "St. Louis, Missouri" });

  return doc.save();
}
