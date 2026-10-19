// Ported from property-intelligence-app's app/lib/property-activity-display.ts.
// Inventory events carry the agency's own short name (LRA/LCRA) rather than a
// generic label; everything else is derived from the event type itself.
import type { DossierEvent } from "./dossier-types.ts";

type PropertyActivityIdentity = Pick<DossierEvent, "eventType" | "sourceKey">;

const inventoryLabels: Record<string, string> = {
  lra: "LRA",
  lcra: "LCRA",
  mo_st_louis_lra_inventory_v1: "LRA",
};

export function propertyActivityLabel(event: PropertyActivityIdentity) {
  if (event.eventType === "acquisition_inventory") {
    return inventoryLabels[event.sourceKey.trim().toLowerCase()] ?? "Property inventory";
  }

  return event.eventType.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
