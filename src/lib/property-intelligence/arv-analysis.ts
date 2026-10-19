// Ported from property-intelligence-app's app/lib/arv-analysis.ts.
// A defensible ARV needs a vetted comparable set: at least MIN_ARV_COMPS
// qualified sales, each time-adjusted by the latest published local
// house-price index, then a median adjusted price per finished square foot
// with an interquartile low/high band. When any input is missing the estimate
// reports incomplete and returns no dollar figure -- the product deliberately
// never presents an unsupported single number.
import type { PropertyProfile } from "./analysis-types.ts";

export const MIN_ARV_COMPS = 6;
export const TARGET_ARV_COMPS = 12;

export type ArvComparable = {
  id: string;
  salePrice: number;
  finishedSquareFeet: number;
  hpiAtSale: number;
};

export type ArvEstimate = {
  complete: boolean;
  comparableCount: number;
  missingInputs: string[];
  medianAdjustedPricePerSquareFoot: number | null;
  lowArv: number | null;
  estimatedArv: number | null;
  highArv: number | null;
};

const roundHundred = (value: number) => Math.round(value / 100) * 100;

function quantile(values: number[], position: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * position;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  // Both indices are in range whenever values is non-empty; the guard is for
  // noUncheckedIndexedAccess, not a behavior change.
  if (lower === undefined || upper === undefined) return null;
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (index - lowerIndex);
}

export function calculateArv(
  subjectFinishedSquareFeet: number | null,
  latestPublishedHpi: number | null,
  comparables: ArvComparable[],
): ArvEstimate {
  const missingInputs: string[] = [];
  if (!subjectFinishedSquareFeet || subjectFinishedSquareFeet <= 0) {
    missingInputs.push("subject finished living area");
  }
  if (!latestPublishedHpi || latestPublishedHpi <= 0) {
    missingInputs.push("latest published local house-price index");
  }

  const adjustedPricesPerSquareFoot =
    latestPublishedHpi && latestPublishedHpi > 0
      ? comparables.flatMap((comparable) => {
          if (
            comparable.salePrice <= 0 ||
            comparable.finishedSquareFeet <= 0 ||
            comparable.hpiAtSale <= 0
          ) {
            return [];
          }
          const timeAdjustedSalePrice =
            (comparable.salePrice * latestPublishedHpi) / comparable.hpiAtSale;
          return [timeAdjustedSalePrice / comparable.finishedSquareFeet];
        })
      : [];

  if (adjustedPricesPerSquareFoot.length < MIN_ARV_COMPS) {
    missingInputs.push(`at least ${MIN_ARV_COMPS} qualified comparable sales`);
  }
  const median = quantile(adjustedPricesPerSquareFoot, 0.5);
  const low = quantile(adjustedPricesPerSquareFoot, 0.25);
  const high = quantile(adjustedPricesPerSquareFoot, 0.75);
  // Split rather than a ternary per field so the non-null narrowing survives
  // into the arithmetic; the values returned are identical either way.
  if (
    missingInputs.length > 0 ||
    !subjectFinishedSquareFeet ||
    median === null ||
    low === null ||
    high === null
  ) {
    return {
      complete: false,
      comparableCount: adjustedPricesPerSquareFoot.length,
      missingInputs,
      medianAdjustedPricePerSquareFoot: median,
      lowArv: null,
      estimatedArv: null,
      highArv: null,
    };
  }

  return {
    complete: true,
    comparableCount: adjustedPricesPerSquareFoot.length,
    missingInputs,
    medianAdjustedPricePerSquareFoot: median,
    lowArv: roundHundred(low * subjectFinishedSquareFeet),
    estimatedArv: roundHundred(median * subjectFinishedSquareFeet),
    highArv: roundHundred(high * subjectFinishedSquareFeet),
  };
}

export function isArvQuestion(question: string) {
  return /\barv\b|after[ -]?(repair|renovation|market repair) value|after market repair/i.test(
    question,
  );
}

export function answerArvQuestion(address: string, profile: PropertyProfile | null) {
  const buildingCount = profile?.residentialBuildingCount;
  const unitCount = profile?.numberOfUnits;
  const looksLikeVacantLand = profile?.vacantLot === true || buildingCount === 0;
  const method = `A defensible Accountabul ARV should use ${MIN_ARV_COMPS}-${TARGET_ARV_COMPS} qualified arms-length comparable sales, start within the last 12 months and a tight radius, expand only when necessary up to five years, time-adjust older sales with the latest published FHFA St. Louis City house-price index, and use the median adjusted price per finished square foot with a low-to-high range.`;

  if (looksLikeVacantLand) {
    return `I cannot calculate a defensible ARV for ${address} yet. The current Assessor record shows ${buildingCount ?? "no published count of"} residential buildings and ${unitCount ?? "no published count of"} units, so this is a vacant-land or proposed-construction analysis rather than an existing-home rehabilitation comp. First provide the planned property type, finished living area, bedrooms, bathrooms, and construction or finish level. ${method} The current connected records do not yet contain that completed-build specification and vetted comp set, so Accountabul has not produced an ARV dollar figure.`;
  }

  return `Accountabul has not calculated a defensible ARV for ${address} yet because the current connected records do not include a vetted comparable-sale set and verified finished living area. ${method} Each result should show the accepted and rejected comps, original sale date and price, time adjustment, distance, similarity, median, range, and confidence instead of presenting an unsupported single number.`;
}
