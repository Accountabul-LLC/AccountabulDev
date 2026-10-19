import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calculateDeal, DEAL_DEFAULTS, type DealInputs } from "@/lib/tools/deal-calculator";

export const Route = createFileRoute("/tools/deal-calculator")({
  head: () => ({
    meta: [
      { title: "Deal calculator — Accountabul" },
      {
        name: "description",
        content:
          "Run cash flow, cap rate, cash-on-cash, and DSCR on a rental deal without leaving Accountabul.",
      },
    ],
  }),
  component: DealCalculatorPage,
});

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const preciseMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const FIELDS: { key: keyof DealInputs; label: string; suffix: string; step: number }[] = [
  { key: "purchasePrice", label: "Purchase price", suffix: "$", step: 1000 },
  { key: "downPaymentPercent", label: "Down payment", suffix: "%", step: 1 },
  { key: "annualInterestRatePercent", label: "Interest rate", suffix: "%", step: 0.125 },
  { key: "loanTermYears", label: "Loan term", suffix: "years", step: 1 },
  { key: "monthlyRent", label: "Monthly rent", suffix: "$", step: 50 },
  { key: "vacancyPercent", label: "Vacancy", suffix: "%", step: 1 },
  { key: "monthlyOperatingExpenses", label: "Monthly expenses", suffix: "$", step: 25 },
  { key: "closingCosts", label: "Closing costs", suffix: "$", step: 500 },
];

function DealCalculatorPage() {
  const [inputs, setInputs] = useState<DealInputs>(DEAL_DEFAULTS);
  const results = useMemo(() => calculateDeal(inputs), [inputs]);
  const positive = results.monthlyCashFlow >= 0;

  return (
    <PageShell
      eyebrow="Tools"
      title="Deal calculator"
      description="Run the numbers on a rental. If a live room is open, the stream keeps playing in the corner while you work."
      contentWidth="wide"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="surface-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Inputs
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <label key={field.key} className="block text-sm">
                <span className="mb-1 block font-medium">
                  {field.label}{" "}
                  <span className="font-normal text-muted-foreground">({field.suffix})</span>
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step={field.step}
                  min={0}
                  value={String(inputs[field.key])}
                  onChange={(event) =>
                    setInputs((current) => ({
                      ...current,
                      [field.key]: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => setInputs(DEAL_DEFAULTS)}
          >
            Reset
          </Button>
        </section>

        <section className="surface-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Results
          </h2>
          <dl className="mt-4 space-y-3">
            <Row label="Loan amount" value={money.format(results.loanAmount)} />
            <Row label="Cash invested" value={money.format(results.cashInvested)} />
            <Row label="Monthly payment" value={preciseMoney.format(results.monthlyDebtService)} />
            <Row label="Effective rent" value={preciseMoney.format(results.effectiveMonthlyRent)} />
            <Row
              label="Monthly cash flow"
              value={preciseMoney.format(results.monthlyCashFlow)}
              tone={positive ? "good" : "bad"}
            />
            <Row label="Annual cash flow" value={money.format(results.annualCashFlow)} />
            <Row label="Net operating income" value={money.format(results.netOperatingIncome)} />
            <Row label="Cap rate" value={`${results.capRatePercent.toFixed(2)}%`} />
            <Row label="Cash on cash" value={`${results.cashOnCashPercent.toFixed(2)}%`} />
            <Row label="DSCR" value={results.debtServiceCoverageRatio.toFixed(2)} />
          </dl>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            These figures are estimates for discussion, not investment, tax, or legal advice.
            Confirm financing terms and operating costs with a licensed professional before you
            commit to a deal.
          </p>
        </section>
      </div>
    </PageShell>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "bad"
        ? "text-destructive"
        : "";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-medium tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}
