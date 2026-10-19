// Ported from property-intelligence-app's app/lib/property-record-summary.ts.
// Every line is tagged "trusted-provider": these are published Assessor fields
// reproduced verbatim, never an Accountabul-derived figure. A field the source
// does not publish reads "Not published" rather than 0 or an empty string, so
// an absent value is never mistaken for a zero value.
import type { PropertyProfile } from "./analysis-types.ts";
import { formatAddress } from "./address-display.ts";
import type { VerificationTier } from "./verification.ts";

export type PropertyRecordLine = { label: string; value: string; verification: VerificationTier };
export type PropertyRecordSection = {
  title: string;
  introduction: string;
  lines: PropertyRecordLine[];
};

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const exactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function shown(value: unknown, formatter?: (value: number) => string) {
  if (value === null || value === undefined || value === "") return "Not published";
  return formatter && typeof value === "number" ? formatter(value) : String(value);
}

function date(value: string | null) {
  if (!value) return "Not published";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function buildPropertyRecordSummary(
  address: string,
  profile: PropertyProfile | null,
): PropertyRecordSection[] {
  if (!profile) return [];
  const provider = "trusted-provider" as const;
  return [
    {
      title: "Property and ownership",
      introduction:
        "The St. Louis City record identifies this property and the names currently attached to the parcel.",
      lines: [
        { label: "Site address", value: formatAddress(address), verification: provider },
        {
          label: "Current owner of record",
          value: shown(profile.ownerName),
          verification: provider,
        },
        {
          label: "Additional owner of record",
          value: shown(profile.ownerName2),
          verification: provider,
        },
        {
          label: "Legal description",
          value: shown(profile.legalDescription),
          verification: provider,
        },
      ],
    },
    {
      title: "Use and buildings",
      introduction:
        "These classifications describe how the city currently identifies the land and improvements.",
      lines: [
        { label: "Zoning", value: shown(profile.zoning), verification: provider },
        { label: "Land use", value: shown(profile.landUseCode), verification: provider },
        {
          label: "Property class",
          value: shown(profile.assessorClassCode ?? profile.propertyClassCode),
          verification: provider,
        },
        {
          label: "Year built",
          value: shown(profile.lastYearBuilt ?? profile.firstYearBuilt),
          verification: provider,
        },
        { label: "Units", value: shown(profile.numberOfUnits), verification: provider },
        { label: "Apartments", value: shown(profile.numberOfApartments), verification: provider },
        {
          label: "Residential buildings",
          value: shown(profile.residentialBuildingCount),
          verification: provider,
        },
        {
          label: "Commercial buildings",
          value: shown(profile.commercialBuildingCount),
          verification: provider,
        },
      ],
    },
    {
      title: "Land and location",
      introduction:
        "The parcel dimensions and location fields below come from the connected Assessor record.",
      lines: [
        {
          label: "Lot size",
          value:
            profile.lotSquareFeet === null
              ? "Not published"
              : `${number.format(profile.lotSquareFeet)} square feet`,
          verification: provider,
        },
        {
          label: "Frontage",
          value:
            profile.frontageFeet === null
              ? "Not published"
              : `${number.format(profile.frontageFeet)} feet`,
          verification: provider,
        },
        { label: "Ward", value: shown(profile.ward), verification: provider },
        { label: "ZIP code", value: shown(profile.zipCode), verification: provider },
      ],
    },
    {
      title: "Assessment and sale history",
      introduction:
        "Assessment figures are public valuation fields. A recorded prior sale is historical evidence, not a current market value or ARV.",
      lines: [
        {
          label: "Total assessed value",
          value: shown(profile.assessedTotalValue, wholeMoney.format),
          verification: provider,
        },
        {
          label: "Assessed land value",
          value: shown(profile.assessedLandValue, wholeMoney.format),
          verification: provider,
        },
        {
          label: "Assessed improvement value",
          value: shown(profile.assessedImprovementValue, wholeMoney.format),
          verification: provider,
        },
        {
          label: "Last residential sale price",
          value: shown(profile.lastResidentialSalePrice, wholeMoney.format),
          verification: provider,
        },
        {
          label: "Last residential sale date",
          value: date(profile.lastResidentialSaleDate),
          verification: provider,
        },
      ],
    },
    {
      title: "Tax and vacancy indicators",
      introduction:
        "These are the latest fields returned by the connected source and should be confirmed with the responsible agency before a transaction.",
      lines: [
        {
          label: "Prior-year property tax",
          value: shown(profile.priorTaxAmount, exactMoney.format),
          verification: provider,
        },
        {
          label: "Current tax balance",
          value: shown(profile.taxBalance, exactMoney.format),
          verification: provider,
        },
        {
          label: "Vacant lot",
          value: profile.vacantLot === null ? "Not published" : profile.vacantLot ? "Yes" : "No",
          verification: provider,
        },
        {
          label: "Vacant building year",
          value: shown(profile.vacantBuildingYear),
          verification: provider,
        },
      ],
    },
  ];
}
