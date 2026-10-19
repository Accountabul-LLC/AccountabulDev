import type { AnalysisEvidence, PropertyProfile, PropertyReport } from "./analysis-types.ts";
import type { PropertyDossier } from "./dossier-types.ts";
import { answerArvQuestion, isArvQuestion } from "./arv-analysis.ts";
import { formatAddress } from "./address-display.ts";
import { CITY_SOURCES } from "./city-sources.ts";
import { summarizeVacancy, vacancySummaryText } from "./property-memory.ts";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat("en-US");

const includesAny = (value: string, words: string[]) =>
  words.some((word) => value.toLowerCase().includes(word));

function eventsMatching(dossier: PropertyDossier, words: string[]) {
  return dossier.events.filter((event) =>
    includesAny(`${event.sourceKey} ${event.eventType} ${event.title}`, words),
  );
}

function evidenceFor(dossier: PropertyDossier): AnalysisEvidence[] {
  const unique = new Map<string, AnalysisEvidence>();
  dossier.events.forEach((event) => {
    const key = `${event.sourceUrl}:${event.eventType}`;
    if (!unique.has(key))
      unique.set(key, {
        label: event.eventType,
        sourceUrl: event.sourceUrl,
        occurredAt: event.occurredAt,
      });
  });
  return [...unique.values()].slice(0, 20);
}

export function buildPropertyReport(
  dossier: PropertyDossier,
  profile: PropertyProfile | null,
  now = new Date(),
): PropertyReport {
  const address = formatAddress(dossier.property?.currentAddress ?? "This property");
  const permits = eventsMatching(dossier, [
    "permit",
    "electrical",
    "mechanical",
    "plumbing",
    "sprinkler",
  ]);
  const inspections = eventsMatching(dossier, ["inspection", "occupancy"]);
  const vacancy = summarizeVacancy(dossier.events);
  const demolition = eventsMatching(dossier, ["demolition"]);
  const verifiedOwnerRecords = dossier.events.filter(
    (event) => event.verificationStatus === "accountabul-verified-owner-record",
  );
  const failedSources = dossier.sources.filter((source) => source.status !== "success");
  const reached = dossier.sources.filter((source) => source.status === "success").length;
  const recordsSeen = dossier.sources.reduce((sum, source) => sum + source.recordsSeen, 0);
  const risks: string[] = [];
  const strengths: string[] = [];

  if (vacancy.sourceRows)
    risks.push(
      `Accountabul found ${vacancySummaryText(vacancy)} Open Vacancy & code to review the evidence.`,
    );
  if (demolition.length)
    risks.push(
      `${demolition.length} demolition-related record${demolition.length === 1 ? "" : "s"} require review before relying on current improvements.`,
    );
  if (profile?.taxBalance && profile.taxBalance > 0)
    risks.push(
      `The current property record reports a tax balance of ${money.format(profile.taxBalance)}; verify the amount and payoff status with the collecting authority.`,
    );
  if (failedSources.length)
    risks.push(
      "The latest intelligence refresh was incomplete, so additional property activity may still exist.",
    );
  if (!dossier.events.length)
    risks.push(
      "No dated property activity was found; this is limited evidence, not proof that nothing happened.",
    );

  if (profile?.taxBalance === 0)
    strengths.push(
      "The current property record reports a $0 tax balance, subject to confirmation with the collecting authority.",
    );
  if (permits.length)
    strengths.push(
      `${permits.length} permit-related record${permits.length === 1 ? " is" : "s are"} linked to the parcel for scope and contractor review.`,
    );
  if (inspections.length)
    strengths.push(
      `${inspections.length} inspection or occupancy record${inspections.length === 1 ? " is" : "s are"} available for condition and compliance review.`,
    );
  if (verifiedOwnerRecords.length)
    strengths.push(
      `${verifiedOwnerRecords.length} owner-submitted record${verifiedOwnerRecords.length === 1 ? " has" : "s have"} passed Accountabul review and remain linked to the original evidence.`,
    );

  const riskLevel =
    vacancy.sourceRows || demolition.length || (profile?.taxBalance ?? 0) > 0
      ? ("attention" as const)
      : dossier.events.length && failedSources.length === 0
        ? ("moderate" as const)
        : ("limited-evidence" as const);

  // Annotated so "trusted-provider" narrows to VerificationTier rather than string.
  const facts: PropertyReport["facts"] = [
    {
      label: "ASR parcel ID",
      value: dossier.property?.asrParcelId ?? "Unresolved",
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
    {
      label: "Site address",
      value: address,
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
    {
      label: "Current owner of record",
      value: profile?.ownerName ?? "Not published",
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
    {
      label: "Additional owner of record",
      value: profile?.ownerName2 ?? "Not published",
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
    {
      label: "Lot size",
      value: profile?.lotSquareFeet
        ? `${number.format(profile.lotSquareFeet)} sq ft`
        : "Not published",
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
    {
      label: "Ward",
      value:
        profile?.ward === null || profile?.ward === undefined
          ? "Not published"
          : String(profile.ward),
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
    {
      label: "Prior-year property tax",
      value:
        profile?.priorTaxAmount === null || profile?.priorTaxAmount === undefined
          ? "Not published"
          : money.format(profile.priorTaxAmount),
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
    {
      label: "Current tax balance",
      value:
        profile?.taxBalance === null || profile?.taxBalance === undefined
          ? "Not published"
          : money.format(profile.taxBalance),
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
    {
      label: "Tax abatement",
      value:
        profile?.isTaxAbated === null || profile?.isTaxAbated === undefined
          ? "Not published"
          : profile.isTaxAbated
            ? `Yes${profile.abatementEndYear ? ` through ${profile.abatementEndYear}` : ""}`
            : "No",
      source: "Trusted data provider",
      verification: "trusted-provider",
    },
  ];

  const ownerRecordSentence = verifiedOwnerRecords.length
    ? ` ${verifiedOwnerRecords.length} owner-submitted record${verifiedOwnerRecords.length === 1 ? " is" : "s are"} separately marked Accountabul-verified.`
    : "";
  const overview = `${address} is anchored to ASR parcel ${dossier.property?.asrParcelId ?? "not yet resolved"}. Accountabul found ${recordsSeen} property records, including ${permits.length} permit-related and ${inspections.length} inspection or occupancy records.${ownerRecordSentence} ${risks[0] ?? "No high-confidence adverse condition was identified in the connected records, but title and legal due diligence remain incomplete."}`;

  return {
    generatedAt: now.toISOString(),
    overview,
    riskLevel,
    facts,
    strengths,
    risks,
    nextChecks: [
      "Order a title search or commitment covering deeds, liens, judgments, probate and recorded exceptions.",
      "Confirm taxes, municipal charges and payoff amounts directly with the responsible agencies.",
      "Treat permit issuance as authorization only; verify final inspections, certificates and actual completion.",
      "Inspect the property and reconcile current physical condition against the public record timeline.",
    ],
    sourceCoverage: { reached, expected: 8, recordsSeen },
    evidence: evidenceFor(dossier),
  };
}

export type PropertyQuestionIntent =
  | "arv"
  | "ownership"
  | "title"
  | "permits"
  | "condition"
  | "taxes"
  | "identity"
  | "physical"
  | "risk"
  | "comparison"
  | "unknown";
export type PropertyQuestionRoute = "deterministic" | "missing_source" | "clarification";
export type PropertyQuestionStatus =
  "answered" | "not_published" | "not_connected" | "needs_user_input";
export type ClaimValidationResult = "pass" | "fail" | "not_applicable";

export type MissingPropertySource = {
  key: string;
  label: string;
  reason: string;
  modelResearchEligible: boolean;
  authoritativeVerificationRequired: boolean;
};

export type ClaimValidationCheck = {
  criterion:
    | "canonical_parcel"
    | "recognized_intent"
    | "required_data"
    | "source_attribution"
    | "prohibited_claims"
    | "uncertainty_boundary";
  result: ClaimValidationResult;
  detail: string;
};

export type PropertyQuestionTraceEvent = {
  stage:
    | "question_received"
    | "question_normalized"
    | "intent_identified"
    | "handler_eligibility"
    | "branch_selected"
    | "sources_checked"
    | "claim_validated"
    | "research_decision"
    | "response_returned";
  decision: string;
  data: Record<string, unknown>;
};

export type PropertyQuestionDecision = {
  rawQuestion: string;
  normalizedQuestion: string;
  intent: PropertyQuestionIntent;
  handlerId: string;
  handlerCanAnswer: boolean;
  route: PropertyQuestionRoute;
  status: PropertyQuestionStatus;
  answer: string;
  evidence: AnalysisEvidence[];
  missingSources: MissingPropertySource[];
  modelResearchEligible: boolean;
  modelResearchReason: string;
  validationPassed: boolean;
  validation: ClaimValidationCheck[];
  trace: PropertyQuestionTraceEvent[];
};

const intentTerms: Array<{
  intent: Exclude<PropertyQuestionIntent, "arv" | "unknown">;
  terms: string[];
}> = [
  {
    intent: "ownership",
    terms: [
      "owner",
      "owns",
      "ownership",
      "entity",
      "business",
      "company",
      "llc",
      "registered agent",
    ],
  },
  { intent: "title", terms: ["title", "deed", "lien", "mortgage", "free and clear"] },
  { intent: "permits", terms: ["permit", "work", "renovation", "contractor"] },
  { intent: "condition", terms: ["vacant", "condemn", "demo", "condition"] },
  { intent: "taxes", terms: ["tax", "abatement"] },
  { intent: "identity", terms: ["address", "parcel", "where is", "ward"] },
  {
    intent: "physical",
    terms: [
      "lot size",
      "square feet",
      "sq ft",
      "built",
      "zoning",
      "unit",
      "assessed",
      "appraised",
      "sale price",
    ],
  },
  {
    intent: "comparison",
    terms: [
      "similar property",
      "similar properties",
      "comparable property",
      "comparable properties",
      "same price",
      "near this price",
    ],
  },
  { intent: "risk", terms: ["risk", "worry", "offer", "invest", "attractive", "deal"] },
];

export function normalizePropertyQuestion(question: string) {
  return question.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function identifyPropertyQuestionIntent(question: string): PropertyQuestionIntent {
  if (isArvQuestion(question)) return "arv";
  const normalized = normalizePropertyQuestion(question);
  return intentTerms.find(({ terms }) => includesAny(normalized, terms))?.intent ?? "unknown";
}

function eventEvidence(events: PropertyDossier["events"]): AnalysisEvidence[] {
  const unique = new Map<string, AnalysisEvidence>();
  events.forEach((event) => {
    if (!event.sourceUrl) return;
    const key = `${event.sourceUrl}:${event.eventType}`;
    if (!unique.has(key))
      unique.set(key, {
        label: event.eventType,
        sourceUrl: event.sourceUrl,
        occurredAt: event.occurredAt,
      });
  });
  return [...unique.values()].slice(0, 20);
}

function profileEvidence(profile: PropertyProfile | null): AnalysisEvidence[] {
  return profile?.sourceUrl
    ? [
        {
          label: "Assessor parcel profile",
          sourceUrl: profile.sourceUrl,
          occurredAt: profile.observedAt,
        },
      ]
    : [];
}

function successfulSourceEvidence(
  dossier: PropertyDossier,
  sourceTerms: string[],
): AnalysisEvidence[] {
  return dossier.sources
    .filter((source) => source.status === "success" && includesAny(source.sourceKey, sourceTerms))
    .map((source) => {
      const definition = CITY_SOURCES.find((candidate) => candidate.key === source.sourceKey);
      return definition
        ? {
            label: definition.label,
            sourceUrl: definition.datasetUrl,
            occurredAt: source.completedAt,
          }
        : null;
    })
    .filter((source): source is AnalysisEvidence => source !== null);
}

function missingSource(
  key: string,
  label: string,
  reason: string,
  modelResearchEligible: boolean,
  authoritativeVerificationRequired = true,
): MissingPropertySource {
  return { key, label, reason, modelResearchEligible, authoritativeVerificationRequired };
}

function validationFor(
  decision: Omit<PropertyQuestionDecision, "validation" | "validationPassed" | "trace">,
  dossier: PropertyDossier,
): ClaimValidationCheck[] {
  const prohibited =
    /\b(title is clear|clear title|free and clear|no liens|mortgage[- ]free|guaranteed value)\b/i.test(
      decision.answer,
    );
  const boundaryRequired = !decision.handlerCanAnswer;
  return [
    {
      criterion: "canonical_parcel",
      result: dossier.property?.matchStatus === "canonical" ? "pass" : "fail",
      detail:
        dossier.property?.matchStatus === "canonical"
          ? "The response is attached to an exact canonical parcel."
          : "The response is not attached to a canonical parcel.",
    },
    {
      criterion: "recognized_intent",
      result: decision.intent === "unknown" ? "not_applicable" : "pass",
      detail:
        decision.intent === "unknown"
          ? "No supported intent matched; the response asks for clarification."
          : `The question matched the ${decision.intent} handler.`,
    },
    {
      criterion: "required_data",
      result: decision.handlerCanAnswer ? "pass" : "not_applicable",
      detail: decision.handlerCanAnswer
        ? "The handler's required data is present."
        : "The requested claim is not answered because required data or a required source is unavailable.",
    },
    {
      criterion: "source_attribution",
      result: decision.handlerCanAnswer
        ? decision.evidence.length
          ? "pass"
          : "fail"
        : "not_applicable",
      detail: decision.handlerCanAnswer
        ? `${decision.evidence.length} question-specific evidence reference${decision.evidence.length === 1 ? " is" : "s are"} attached.`
        : "No source is presented as proof of the unavailable claim.",
    },
    {
      criterion: "prohibited_claims",
      result: prohibited ? "fail" : "pass",
      detail: prohibited
        ? "The response contains an unsupported certainty phrase."
        : "The response does not declare clear title, no liens, mortgage-free status, or guaranteed value.",
    },
    {
      criterion: "uncertainty_boundary",
      result: boundaryRequired
        ? decision.missingSources.length || decision.status === "needs_user_input"
          ? "pass"
          : "fail"
        : "not_applicable",
      detail: boundaryRequired
        ? "The response records why the requested claim cannot be answered and what is needed next."
        : "The requested claim is supported by the connected data.",
    },
  ];
}

export function routePropertyQuestion(
  question: string,
  report: PropertyReport,
  dossier: PropertyDossier,
  profile: PropertyProfile | null = null,
): PropertyQuestionDecision {
  const normalized = normalizePropertyQuestion(question);
  const intent = identifyPropertyQuestionIntent(question);
  const address = formatAddress(dossier.property?.currentAddress ?? "this property");
  const permits = eventsMatching(dossier, [
    "permit",
    "electrical",
    "mechanical",
    "plumbing",
    "sprinkler",
  ]);
  const vacancy = summarizeVacancy(dossier.events);
  const demolition = eventsMatching(dossier, ["demolition"]);
  let handlerId = `property.${intent}`;
  let handlerCanAnswer = true;
  let route: PropertyQuestionRoute = "deterministic";
  let status: PropertyQuestionStatus = "answered";
  let answer = "";
  let evidence: AnalysisEvidence[] = [];
  const missingSources: MissingPropertySource[] = [];

  if (intent === "arv") {
    handlerCanAnswer = false;
    route = "missing_source";
    status = "not_connected";
    answer = answerArvQuestion(address, profile);
    missingSources.push(
      missingSource(
        "qualified-comparable-sales",
        "Qualified comparable sales",
        "A vetted comparable-sale feed and the required subject-property inputs are not connected.",
        true,
      ),
    );
  } else if (intent === "ownership") {
    const owners = [profile?.ownerName, profile?.ownerName2].filter((owner): owner is string =>
      Boolean(owner),
    );
    evidence = profileEvidence(profile);
    answer = owners.length
      ? `The connected public parcel record lists ${owners.join(" and ")} as the reported owner${owners.length === 1 ? "" : "s"} of ${address}. This establishes the owner name published for this parcel; it does not prove current title, beneficial ownership, authority to sell, or whether a named business is active. An entity-registry source is not connected yet, so formation date, status, registered agent, managers, and related entities still require a Secretary of State or equivalent registry search. A title search or commitment is still required for legal ownership, deeds, liens, judgments, probate, and recorded exceptions.`
      : `The connected parcel record does not publish an owner name for ${address}. Accountabul will not infer one. Confirm the owner through the Assessor and recorded instruments, use the appropriate entity registry for any business name, and obtain a title search or commitment before relying on ownership.`;
    missingSources.push(
      missingSource(
        "entity-registry",
        "Entity-registry record",
        "Business formation, status, registered-agent, manager, and related-entity records are not connected.",
        true,
      ),
    );
    missingSources.push(
      missingSource(
        "recorded-title-evidence",
        "Recorded title evidence",
        "The parcel owner field is not a title search or title commitment.",
        false,
      ),
    );
    if (!owners.length) {
      handlerCanAnswer = false;
      route = "missing_source";
      status = "not_published";
      missingSources.push(
        missingSource(
          "assessor-owner",
          "Published owner record",
          "The connected parcel profile does not publish an owner name.",
          true,
        ),
      );
    }
  } else if (intent === "title") {
    handlerCanAnswer = false;
    route = "missing_source";
    status = "not_connected";
    answer =
      "The available property records do not establish clear or insurable title. Accountabul can show parcel identity and recorded activity, but a title search or commitment is still required for deeds, liens, judgments, probate, legal description and recorded exceptions.";
    missingSources.push(
      missingSource(
        "recorded-title-evidence",
        "Recorded title evidence",
        "Recorder instruments and a title commitment are not connected.",
        false,
      ),
    );
  } else if (intent === "permits") {
    evidence = [
      ...successfulSourceEvidence(dossier, [
        "permit",
        "electrical",
        "mechanical",
        "plumbing",
        "sprinkler",
      ]),
      ...eventEvidence(permits),
    ];
    answer = permits.length
      ? `I found ${permits.length} permit-related timeline records. Review their scope, contractor, status and dates. A permit proves authorization, not completed work; look for a final inspection or certificate before treating the work as verified.`
      : "No permit-related records were found. That is not proof that no work occurred; older records or unpermitted work may still exist.";
    const failedPermitSources = dossier.sources.filter(
      (source) =>
        source.status !== "success" &&
        includesAny(source.sourceKey, [
          "permit",
          "electrical",
          "mechanical",
          "plumbing",
          "sprinkler",
        ]),
    );
    if (failedPermitSources.length) {
      handlerCanAnswer = false;
      route = "missing_source";
      status = "not_connected";
      failedPermitSources.forEach((source) =>
        missingSources.push(
          missingSource(
            source.sourceKey,
            source.sourceKey.replaceAll("_", " "),
            "The latest source refresh did not succeed.",
            true,
          ),
        ),
      );
    }
  } else if (intent === "condition") {
    evidence = [
      ...successfulSourceEvidence(dossier, ["vacant", "demolition", "inspection"]),
      ...eventEvidence([...eventsMatching(dossier, ["vacant", "condemn"]), ...demolition]),
    ];
    answer =
      vacancy.sourceRows || demolition.length
        ? `Accountabul found ${vacancySummaryText(vacancy)} I also found ${demolition.length} demolition-related record${demolition.length === 1 ? "" : "s"}. Open Vacancy & code for exact descriptions, dates, statuses, and amounts before estimating rehabilitation scope.`
        : "No vacancy, condemnation, or demolition record was found, but a physical inspection is still required.";
  } else if (intent === "taxes") {
    evidence = profileEvidence(profile);
    const asksAbatement = normalized.includes("abatement");
    handlerId = asksAbatement ? "property.taxes.abatement" : "property.taxes.balance";
    const value = asksAbatement ? profile?.isTaxAbated : profile?.taxBalance;
    if (value === null || value === undefined) {
      handlerCanAnswer = false;
      route = "missing_source";
      status = "not_published";
      answer = asksAbatement
        ? `The connected parcel profile does not publish a tax-abatement status for ${address}. Accountabul will not infer one.`
        : `The connected parcel profile does not publish a current tax balance for ${address}. Accountabul will not infer whether taxes are paid.`;
      missingSources.push(
        missingSource(
          asksAbatement ? "tax-abatement-status" : "current-tax-balance",
          asksAbatement ? "Tax-abatement status" : "Current tax balance",
          "The requested tax field is not published in the connected parcel profile.",
          true,
        ),
      );
    } else {
      answer = asksAbatement
        ? `The connected parcel profile reports tax abatement as ${profile?.isTaxAbated ? `Yes${profile.abatementEndYear ? ` through ${profile.abatementEndYear}` : ""}` : "No"}. Confirm current eligibility and terms with the responsible taxing authority.`
        : `The connected parcel profile reports a current tax balance of ${money.format(profile?.taxBalance ?? 0)}. This is not a payoff statement or a search for additional municipal charges, liens, penalties, or later activity; confirm the current amount with the collecting authority.`;
    }
  } else if (intent === "identity") {
    evidence = profileEvidence(profile);
    if (normalized.includes("ward"))
      answer =
        profile?.ward === null || profile?.ward === undefined
          ? `The connected parcel profile does not publish a ward for ${address}.`
          : `${address} is reported in Ward ${profile.ward}.`;
    else if (normalized.includes("parcel"))
      answer = `The canonical ASR parcel ID for ${address} is ${dossier.property?.asrParcelId ?? "not resolved"}.`;
    else
      answer = `The connected Assessor parcel address is ${address}, associated with ASR parcel ${dossier.property?.asrParcelId ?? "not resolved"}.`;
    if (
      (normalized.includes("ward") && (profile?.ward === null || profile?.ward === undefined)) ||
      !dossier.property?.asrParcelId
    ) {
      handlerCanAnswer = false;
      route = "missing_source";
      status = "not_published";
      missingSources.push(
        missingSource(
          "parcel-identity-field",
          "Parcel identity field",
          "The requested identity field is not published in the connected parcel profile.",
          true,
        ),
      );
    }
  } else if (intent === "physical") {
    evidence = profileEvidence(profile);
    const physicalFacts: Array<{
      matches: string[];
      id: string;
      label: string;
      value: string | null;
    }> = [
      {
        matches: ["lot size", "square feet", "sq ft"],
        id: "lot-size",
        label: "Lot size",
        value: profile?.lotSquareFeet
          ? `${number.format(profile.lotSquareFeet)} square feet`
          : null,
      },
      {
        matches: ["built"],
        id: "year-built",
        label: "Year built",
        value: profile?.lastYearBuilt
          ? String(profile.lastYearBuilt)
          : profile?.firstYearBuilt
            ? String(profile.firstYearBuilt)
            : null,
      },
      { matches: ["zoning"], id: "zoning", label: "Zoning", value: profile?.zoning ?? null },
      {
        matches: ["unit"],
        id: "unit-count",
        label: "Unit count",
        value:
          profile?.numberOfUnits === null || profile?.numberOfUnits === undefined
            ? null
            : String(profile.numberOfUnits),
      },
      {
        matches: ["assessed"],
        id: "assessed-value",
        label: "Assessed total value",
        value:
          profile?.assessedTotalValue === null || profile?.assessedTotalValue === undefined
            ? null
            : money.format(profile.assessedTotalValue),
      },
      {
        matches: ["appraised"],
        id: "appraised-value",
        label: "Published appraised value",
        value:
          profile?.appraisedLandValue === null || profile?.appraisedLandValue === undefined
            ? null
            : money.format(
                (profile.appraisedLandValue ?? 0) + (profile.appraisedImprovementValue ?? 0),
              ),
      },
      {
        matches: ["sale price"],
        id: "last-sale-price",
        label: "Last residential sale price",
        value:
          profile?.lastResidentialSalePrice === null ||
          profile?.lastResidentialSalePrice === undefined
            ? null
            : money.format(profile.lastResidentialSalePrice),
      },
    ];
    const fact =
      physicalFacts.find((candidate) =>
        candidate.matches.some((term) => normalized.includes(term)),
      ) ?? physicalFacts[0];
    // physicalFacts is a non-empty literal above, so the fallback always
    // resolves; the guard is for noUncheckedIndexedAccess.
    if (fact === undefined) throw new Error("physical fact table is empty");
    handlerId = `property.physical.${fact.id}`;
    if (fact.value === null) {
      handlerCanAnswer = false;
      route = "missing_source";
      status = "not_published";
      answer = `The connected parcel profile does not publish ${fact.label.toLowerCase()} for ${address}. Accountabul will not infer it.`;
      missingSources.push(
        missingSource(
          fact.id,
          fact.label,
          "The requested physical-property field is not published in the connected parcel profile.",
          true,
        ),
      );
    } else {
      answer = `The connected parcel profile reports ${fact.label.toLowerCase()} as ${fact.value} for ${address}.`;
    }
  } else if (intent === "comparison") {
    handlerCanAnswer = false;
    route = "missing_source";
    status = "not_connected";
    answer =
      "Accountabul does not yet have a vetted property-comparison index connected to this chat. A model may help discover candidates, but structured parcel filters and verified price, location, property-type, and sale data must determine which properties are actually comparable.";
    missingSources.push(
      missingSource(
        "property-comparison-index",
        "Property comparison index",
        "Verified comparison candidates and ranking fields are not connected to the question router.",
        true,
      ),
    );
  } else if (intent === "risk") {
    evidence = [...profileEvidence(profile), ...report.evidence];
    const risks = report.risks.length
      ? report.risks.join(" ")
      : "No high-confidence adverse condition was identified in the connected records.";
    const strengths = report.strengths.length
      ? report.strengths.join(" ")
      : "The current evidence is too limited to identify a strong investment advantage.";
    answer = `Risk view: ${risks} Positive signals: ${strengths} This is an evidence summary, not a recommendation to purchase or an estimate of value.`;
  } else {
    handlerId = "property.unknown";
    handlerCanAnswer = false;
    route = "clarification";
    status = "needs_user_input";
    answer = `${report.overview} Ask a specific question about ownership, parcel identity, lot or building facts, permits, vacancy, taxes, title evidence, value, comparable properties, or investment risks.`;
  }

  const modelResearchEligible = missingSources.some((source) => source.modelResearchEligible);
  const modelResearchReason = modelResearchEligible
    ? "A language model may discover candidate records or sources, but the result must remain unverified until an authoritative source is connected and the claim passes the same validation criteria."
    : missingSources.length
      ? "The missing evidence requires an authoritative professional or government record; model output cannot substitute for it."
      : "The deterministic handler has the required data or needs a clearer question, so model research is not needed.";
  const baseDecision = {
    rawQuestion: question,
    normalizedQuestion: normalized,
    intent,
    handlerId,
    handlerCanAnswer,
    route,
    status,
    answer,
    evidence,
    missingSources,
    modelResearchEligible,
    modelResearchReason,
  };
  const validation = validationFor(baseDecision, dossier);
  const validationPassed = validation.every((check) => check.result !== "fail");
  const trace: PropertyQuestionTraceEvent[] = [
    { stage: "question_received", decision: "captured", data: { characterCount: question.length } },
    {
      stage: "question_normalized",
      decision: "normalized",
      data: { normalizedQuestion: normalized },
    },
    { stage: "intent_identified", decision: intent, data: { handlerId } },
    {
      stage: "handler_eligibility",
      decision: handlerCanAnswer ? "yes" : "no",
      data: { handlerId },
    },
    { stage: "branch_selected", decision: route, data: { status } },
    {
      stage: "sources_checked",
      decision: missingSources.length ? "missing" : "available",
      data: { evidenceCount: evidence.length, missingSources },
    },
    {
      stage: "claim_validated",
      decision: validationPassed ? "pass" : "fail",
      data: { validation },
    },
    {
      stage: "research_decision",
      decision: modelResearchEligible ? "eligible" : "not_eligible",
      data: { reason: modelResearchReason },
    },
    { stage: "response_returned", decision: status, data: { evidenceCount: evidence.length } },
  ];
  return { ...baseDecision, validationPassed, validation, trace };
}

export function answerPropertyQuestion(
  question: string,
  report: PropertyReport,
  dossier: PropertyDossier,
  profile: PropertyProfile | null = null,
) {
  return routePropertyQuestion(question, report, dossier, profile).answer;
}
