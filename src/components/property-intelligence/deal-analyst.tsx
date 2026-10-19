// Adapted from Accountabul-LLC/property-insight-hub src/components/deal-analyst.tsx.
// property-insight-hub's deal-analyst.tsx is a chat-driven workspace backed by
// analysis-store.server.ts / property-chat.server.ts (new tables this pass does not port —
// see docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). accountabul-final already has a fully working,
// deterministic deal-analysis form + saved-scenario flow (property-intelligence.functions.ts,
// backed by supabase/migrations/20260923140000_property_deal_scenarios.sql), so per the port
// instructions this component keeps that existing, working data path rather than the AI-chat
// one, restyled to match property-insight-hub's card layout.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEAL_STRATEGIES,
  calculateDeal,
  normalizeDealInputs,
  type DealInputs,
} from "@/lib/property-intelligence/deal-analysis";
import {
  deleteDealScenario,
  listDealScenarios,
  saveDealScenario,
} from "@/lib/property-intelligence/property-intelligence.functions";

export type DealTarget = {
  address: string;
  parcelId: string | null;
  recordId: string | null;
  priceMissing: boolean;
};

const money = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

const NUMBER_FIELDS: Array<[keyof DealInputs, string]> = [
  ["purchasePrice", "Purchase price"],
  ["rehabBudget", "Rehab budget"],
  ["afterRepairValue", "After-repair value"],
  ["downPayment", "Down payment"],
  ["loanAmount", "Loan amount"],
  ["interestRatePercent", "Interest rate %"],
  ["loanTermYears", "Loan term (years)"],
  ["closingCostPercent", "Closing costs %"],
];

function Select<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

export default function DealAnalyst({
  target,
  seed,
}: {
  target: DealTarget | null;
  seed: DealInputs;
}) {
  const queryClient = useQueryClient();
  const list = useServerFn(listDealScenarios);
  const save = useServerFn(saveDealScenario);
  const remove = useServerFn(deleteDealScenario);
  const [inputs, setInputs] = useState<DealInputs>(seed);
  const [label, setLabel] = useState(target?.address ?? "");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const results = useMemo(() => calculateDeal(inputs), [inputs]);
  const needsPrice = inputs.purchasePrice <= 0;
  const rent = inputs.incomeUnits[0]?.monthlyRent ?? 0;
  const expenses = inputs.operatingExpenses.reduce((sum, item) => sum + item.monthlyAmount, 0);

  const scenarios = useQuery({ queryKey: ["deal-scenarios"], queryFn: () => list() });
  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: scenarioId,
          label,
          propertyAddress: target?.address ?? null,
          parcelId: target?.parcelId ?? null,
          recordId: target?.recordId ?? null,
          inputs,
        },
      }),
    onSuccess: (saved) => {
      setScenarioId(saved.id);
      toast.success("Scenario saved");
      void queryClient.invalidateQueries({ queryKey: ["deal-scenarios"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save."),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: (_, id) => {
      if (id === scenarioId) setScenarioId(null);
      void queryClient.invalidateQueries({ queryKey: ["deal-scenarios"] });
    },
  });

  const setNumber = (key: keyof DealInputs, raw: string) => {
    const value = Number(raw.replace(/[$,\s]/g, ""));
    setInputs((current) => ({ ...current, [key]: Number.isFinite(value) ? value : 0 }));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section className="surface-card p-5">
        <h2 className="font-display text-xl font-semibold">
          {target ? target.address : "New deal analysis"}
        </h2>
        {needsPrice ? (
          <p role="status" className="mt-2 rounded-md bg-secondary p-3 text-sm">
            {target?.priceMissing
              ? "The city has not published a price for this property. It sells through an offer, so enter the amount you plan to offer as the purchase price."
              : "Enter a purchase price to see results."}
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="deal-label">Scenario name</Label>
            <Input
              id="deal-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <Select
            id="deal-strategy"
            label="Strategy"
            value={inputs.strategy}
            onChange={(strategy) => setInputs((current) => ({ ...current, strategy }))}
            options={DEAL_STRATEGIES.map((option) => [option.value, option.label])}
          />
          <Select
            id="deal-financing"
            label="Financing"
            value={inputs.purchaseFinancing}
            onChange={(purchaseFinancing) =>
              setInputs((current) => ({ ...current, purchaseFinancing }))
            }
            options={[
              ["cash", "Cash purchase"],
              ["mortgage", "Primary mortgage"],
              ["mixed", "Mixed funding"],
            ]}
          />
          {NUMBER_FIELDS.map(([key, fieldLabel]) => (
            <div key={key}>
              <Label htmlFor={`deal-${key}`}>{fieldLabel}</Label>
              <Input
                id={`deal-${key}`}
                inputMode="decimal"
                value={String(inputs[key] ?? 0)}
                onChange={(event) => setNumber(key, event.target.value)}
              />
            </div>
          ))}
          <div>
            <Label htmlFor="deal-rent">Monthly rent</Label>
            <Input
              id="deal-rent"
              inputMode="decimal"
              value={String(rent)}
              onChange={(event) => {
                const value = Number(event.target.value.replace(/[$,\s]/g, "")) || 0;
                setInputs((current) =>
                  normalizeDealInputs({
                    ...current,
                    incomeUnits: current.incomeUnits.map((unit, index) =>
                      index === 0 ? { ...unit, monthlyRent: value } : unit,
                    ),
                  }),
                );
              }}
            />
          </div>
          <div>
            <Label htmlFor="deal-expenses">Monthly operating expenses</Label>
            <Input
              id="deal-expenses"
              inputMode="decimal"
              value={String(expenses)}
              onChange={(event) => {
                const value = Number(event.target.value.replace(/[$,\s]/g, "")) || 0;
                setInputs((current) => ({
                  ...current,
                  operatingExpenses: current.operatingExpenses.map((item, index) => ({
                    ...item,
                    monthlyAmount: index === 0 ? value : 0,
                  })),
                }));
              }}
            />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !label.trim() || needsPrice}
          >
            {saveMutation.isPending ? "Saving…" : scenarioId ? "Update scenario" : "Save scenario"}
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="surface-card p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-lg font-semibold">Results</h3>
            <span
              aria-label="Deal grade"
              className="rounded-md bg-accent px-3 py-1 font-display text-2xl font-semibold text-accent-foreground"
            >
              {needsPrice ? "—" : (results.dealGrade ?? "—")}
            </span>
          </div>
          {needsPrice ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Results appear once a purchase price is entered.
            </p>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Metric label="All-in cost" value={money(results.allInCost)} />
              <Metric label="Cash to close" value={money(results.cashToClose)} />
              <Metric label="Monthly cash flow" value={money(results.monthlyCashFlow)} />
              <Metric label="Monthly NOI" value={money(results.monthlyNoi)} />
              <Metric
                label="Cap rate"
                value={
                  results.capRatePercent === null ? "—" : `${results.capRatePercent.toFixed(1)}%`
                }
              />
              <Metric
                label="Cash on cash"
                value={
                  results.cashOnCashPercent === null
                    ? "—"
                    : `${results.cashOnCashPercent.toFixed(1)}%`
                }
              />
              <Metric label="DSCR" value={results.dscr === null ? "—" : results.dscr.toFixed(2)} />
              <Metric label="Debt service / mo" value={money(results.monthlyDebtService)} />
            </dl>
          )}
          {!needsPrice && results.missingInputs.length ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Still needed: {results.missingInputs.join(", ")}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">{results.explanation}</p>
        </div>

        <div className="surface-card p-5">
          <h3 className="font-display text-lg font-semibold">Saved scenarios</h3>
          <ul className="mt-3 divide-y divide-border text-sm">
            {(scenarios.data ?? []).map((scenario) => (
              <li key={scenario.id} className="flex items-center justify-between gap-2 py-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => {
                    setScenarioId(scenario.id);
                    setLabel(scenario.label);
                    setInputs(normalizeDealInputs(scenario.inputs));
                  }}
                >
                  <span className="block font-medium">{scenario.label}</span>
                  <span className="text-xs text-muted-foreground">
                    Grade {(scenario.results as { dealGrade?: string } | null)?.dealGrade ?? "—"} ·{" "}
                    {new Date(scenario.updated_at).toLocaleDateString()}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${scenario.label}`}
                  onClick={() => deleteMutation.mutate(scenario.id)}
                >
                  Delete
                </Button>
              </li>
            ))}
            {scenarios.data?.length === 0 ? (
              <li className="py-2 text-xs text-muted-foreground">No saved scenarios yet.</li>
            ) : null}
          </ul>
        </div>
      </section>
    </div>
  );
}
