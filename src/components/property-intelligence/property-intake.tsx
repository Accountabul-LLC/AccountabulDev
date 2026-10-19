// Ported from Accountabul-LLC/property-intelligence-app's property-intake.tsx.
//
// Intake is what the owner or investigator claims about a property, kept
// deliberately separate from what a source published. Nothing here is
// evidence: these answers are the user's own, scoped to their workspace, and
// the analysis layer treats them as claims rather than facts.
//
// Normalization and range-checking live in normalizePropertyIntakeClaims and
// run again on the server, so this form's inputs are a convenience, not the
// validation boundary. A value this component would reject is rejected again
// server-side; a value it would allow through still has to pass there.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PropertyIntakeClaims } from "@/lib/property-intelligence/analysis-types";
import {
  getPropertyIntake,
  savePropertyIntake,
} from "@/lib/property-intelligence/property-intake-notice.functions";

const PROPERTY_USES: PropertyIntakeClaims["propertyUse"][] = [
  "unknown",
  "single-family",
  "duplex",
  "triplex",
  "fourplex",
  "multi-family",
  "commercial",
  "mixed-use",
  "land",
  "other",
];

const OCCUPANCIES: PropertyIntakeClaims["currentOccupancy"][] = [
  "unknown",
  "owner-occupied",
  "tenant-occupied",
  "vacant",
];

const CONDITIONS: PropertyIntakeClaims["condition"][] = [
  "unknown",
  "turnkey",
  "light-rehab",
  "moderate-rehab",
  "full-rehab",
];

function label(value: string) {
  return value === "unknown"
    ? "Not stated"
    : value.replace(/-/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function emptyClaims(): PropertyIntakeClaims {
  return {
    propertyUse: "unknown",
    bedrooms: null,
    bathrooms: null,
    interiorSquareFeet: null,
    currentOccupancy: "unknown",
    condition: "unknown",
    notes: "",
    updatedAt: null,
  };
}

function numberField(value: number | null) {
  return value === null ? "" : String(value);
}

export function PropertyIntake({ threadId }: { threadId: string }) {
  const queryClient = useQueryClient();
  const getIntake = useServerFn(getPropertyIntake);
  const saveIntake = useServerFn(savePropertyIntake);
  const [claims, setClaims] = useState<PropertyIntakeClaims>(emptyClaims);

  const { data } = useQuery<PropertyIntakeClaims>({
    queryKey: ["property-intake", threadId],
    queryFn: () => getIntake({ data: { threadId } }),
  });

  // The server's stored answers win on load and after every save; local edits
  // are a draft until one of those returns.
  useEffect(() => {
    if (data) setClaims(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (next: PropertyIntakeClaims) => saveIntake({ data: { threadId, claims: next } }),
    onSuccess: async (saved: PropertyIntakeClaims) => {
      setClaims(saved);
      await queryClient.invalidateQueries({ queryKey: ["property-intake", threadId] });
      toast.success("Intake saved.");
    },
    onError: (error: unknown) => {
      // Surfaced rather than swallowed: a rejected value means the server
      // refused a claim, and the user needs to know which one.
      toast.error(error instanceof Error ? error.message : "That intake could not be saved.");
    },
  });

  function update<Key extends keyof PropertyIntakeClaims>(
    key: Key,
    value: PropertyIntakeClaims[Key],
  ) {
    setClaims((current) => ({ ...current, [key]: value }));
  }

  function numeric(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(claims);
      }}
    >
      <div>
        <h3 className="text-base font-semibold">What you know about this property</h3>
        <p className="text-sm text-muted-foreground">
          Your own answers, kept separate from published records. Analysis treats these as claims,
          not evidence.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="intake-property-use">Property use</Label>
          <select
            id="intake-property-use"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={claims.propertyUse}
            onChange={(event) =>
              update("propertyUse", event.target.value as PropertyIntakeClaims["propertyUse"])
            }
          >
            {PROPERTY_USES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="intake-occupancy">Current occupancy</Label>
          <select
            id="intake-occupancy"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={claims.currentOccupancy}
            onChange={(event) =>
              update(
                "currentOccupancy",
                event.target.value as PropertyIntakeClaims["currentOccupancy"],
              )
            }
          >
            {OCCUPANCIES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="intake-bedrooms">Bedrooms</Label>
          <Input
            id="intake-bedrooms"
            inputMode="numeric"
            value={numberField(claims.bedrooms)}
            onChange={(event) => update("bedrooms", numeric(event.target.value))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="intake-bathrooms">Bathrooms</Label>
          <Input
            id="intake-bathrooms"
            inputMode="decimal"
            value={numberField(claims.bathrooms)}
            onChange={(event) => update("bathrooms", numeric(event.target.value))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="intake-square-feet">Interior square feet</Label>
          <Input
            id="intake-square-feet"
            inputMode="numeric"
            value={numberField(claims.interiorSquareFeet)}
            onChange={(event) => update("interiorSquareFeet", numeric(event.target.value))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="intake-condition">Condition</Label>
          <select
            id="intake-condition"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={claims.condition}
            onChange={(event) =>
              update("condition", event.target.value as PropertyIntakeClaims["condition"])
            }
          >
            {CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="intake-notes">Notes</Label>
        <Textarea
          id="intake-notes"
          rows={4}
          value={claims.notes}
          onChange={(event) => update("notes", event.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save intake"}
        </Button>
        {claims.updatedAt ? (
          <span className="text-xs text-muted-foreground">
            Last saved {new Date(claims.updatedAt).toLocaleString()}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export default PropertyIntake;
