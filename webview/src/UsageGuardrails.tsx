import { useCallback, useEffect, useId, useState } from "react";
import type {
  PeriodInsights,
  RankedContributor,
  UsageForecast,
  UsageBudgets,
  UsageGranularity
} from "../../src/shared/dashboard.js";

export type BudgetSaveState = "idle" | "saving" | "saved" | "error";

export interface UsageGuardrailsProps {
  granularity: UsageGranularity;
  budgets: UsageBudgets;
  insights: PeriodInsights;
  forecast: UsageForecast;
  saveState: BudgetSaveState;
  saveError: string | null;
  onSave: (budgets: UsageBudgets) => void;
  onSaveSettled: () => void;
}

const periodLabels: Record<UsageGranularity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly"
};
const sourceLabels = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  antigravity: "Antigravity"
};
const budgetKeys: Array<keyof UsageBudgets> = ["daily", "weekly", "monthly"];
const numberFormatter = new Intl.NumberFormat();
const forecastStatusLabels: Record<UsageForecast["status"], string> = {
  on_pace: "On pace",
  at_risk: "At risk",
  likely_to_exceed: "Likely to exceed",
  budget_exceeded: "Budget exceeded",
  incomplete_data: "Incomplete data",
  no_budget: "No budget configured",
  not_enough_elapsed_time: "Not enough elapsed time"
};
const forecastStatusClasses: Record<UsageForecast["status"], string> = {
  on_pace: "on-track",
  at_risk: "approaching",
  likely_to_exceed: "exceeded",
  budget_exceeded: "exceeded",
  incomplete_data: "approaching",
  no_budget: "disabled",
  not_enough_elapsed_time: "disabled"
};

function forecastPrefix(quality: UsageForecast["quality"]): string {
  if (quality === "partial") return "≥";
  if (quality === "estimated") return "≈";
  return "";
}

function formatProjectedValue(forecast: UsageForecast, value: number | null): string {
  if (value == null) {
    return forecast.status === "not_enough_elapsed_time"
      ? "Not enough elapsed time"
      : "—";
  }
  return `${forecastPrefix(forecast.quality)}${numberFormatter.format(Math.round(value))}`;
}

function formatProjectedPercent(forecast: UsageForecast): string {
  if (forecast.projectedBudgetPercent == null) return "—";
  return `${forecastPrefix(forecast.quality)}${forecast.projectedBudgetPercent.toFixed(1)}%`;
}

function confidenceLabel(confidence: UsageForecast["confidence"]): string {
  if (confidence == null) return "—";
  return confidence[0].toUpperCase() + confidence.slice(1);
}

function budgetStatus(used: number, budget: number) {
  if (budget === 0) return { label: "No budget set", className: "disabled" };
  const percent = (used / budget) * 100;
  if (percent >= 100) return { label: "Budget exceeded", className: "exceeded" };
  if (percent >= 80) return { label: "Approaching limit", className: "approaching" };
  return { label: "On track", className: "on-track" };
}

function parseBudget(value: string): number | null {
  if (value.trim() === "") return 0;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function projectPathLabel(project: string | null | undefined): string {
  if (!project?.trim()) return "Unknown";
  return project.split(/[\\/]/u).filter(Boolean).at(-1) ?? "Unknown";
}

function AccessiblePath({ label, fullPath }: { label: string; fullPath?: string }) {
  const descriptionId = useId();
  const description = fullPath?.trim();
  return (
    <>
      <span
        aria-label={label}
        title={description || undefined}
        aria-describedby={description ? descriptionId : undefined}
      >{label}</span>
      {description && <span id={descriptionId} className="sr-only">{description}</span>}
    </>
  );
}

function ContributorGroup({ title, items }: { title: string; items: RankedContributor[] }) {
  return (
    <div className="contributor-group">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="empty-copy">No usage in this period</p> : (
        <ol>{items.map((item) => (
          <li key={item.key}>
            <AccessiblePath label={item.label} fullPath={item.fullLabel} />
            <span>
              {item.partial ? "≥" : ""}{numberFormatter.format(item.tokens)}
              {" · "}{(item.share * 100).toFixed(1)}%
            </span>
          </li>
        ))}</ol>
      )}
    </div>
  );
}

export function UsageGuardrails({
  granularity,
  budgets,
  insights,
  forecast,
  saveState,
  saveError,
  onSave,
  onSaveSettled
}: UsageGuardrailsProps) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<keyof UsageBudgets, string>>({
    daily: String(budgets.daily),
    weekly: String(budgets.weekly),
    monthly: String(budgets.monthly)
  });
  const [errors, setErrors] = useState<Partial<Record<keyof UsageBudgets, string>>>({});
  const budget = budgets[granularity];
  const status = budgetStatus(insights.total, budget);
  const percent = budget === 0 ? 0 : (insights.total / budget) * 100;
  const remaining = Math.max(0, budget - insights.total);

  const resetEditor = useCallback(() => {
    setValues({
      daily: String(budgets.daily),
      weekly: String(budgets.weekly),
      monthly: String(budgets.monthly)
    });
    setErrors({});
  }, [budgets.daily, budgets.weekly, budgets.monthly]);

  useEffect(() => {
    if (saveState !== "saved") return;
    resetEditor();
    setEditing(false);
    onSaveSettled();
  }, [saveState, resetEditor, onSaveSettled]);

  const submit = () => {
    const parsed = Object.fromEntries(
      budgetKeys.map((key) => [key, parseBudget(values[key])])
    ) as Record<keyof UsageBudgets, number | null>;
    const nextErrors = Object.fromEntries(
      budgetKeys
        .filter((key) => parsed[key] == null)
        .map((key) => [key, "Enter a whole, non-negative number."])
    ) as Partial<Record<keyof UsageBudgets, string>>;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSave(parsed as UsageBudgets);
  };

  return (
    <section className="guardrails-panel" aria-labelledby="usage-guardrails-heading">
      <div className="guardrails-heading">
        <div>
          <h2 id="usage-guardrails-heading">Usage Guardrails</h2>
          <p>{periodLabels[granularity]} period ending {insights.endDate}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => {
          resetEditor();
          setEditing(true);
        }}>
          {budget === 0 ? "Set token budget" : "Edit budgets"}
        </button>
      </div>

      <div className="guardrail-budget">
        <div><span>Used</span><strong>{insights.partial ? "≥" : ""}{numberFormatter.format(insights.total)}</strong></div>
        <div><span>Limit</span><strong>{budget === 0 ? "Disabled" : numberFormatter.format(budget)}</strong></div>
        <div>
          <span>Remaining</span>
          <strong>
            {budget === 0
              ? "—"
              : `${insights.partial ? "≤" : ""}${numberFormatter.format(remaining)}`}
          </strong>
        </div>
        <div><span>Usage</span><strong>{budget === 0 ? "—" : `${percent.toFixed(1)}%`}</strong></div>
        <p className={`budget-status ${status.className}`}>{status.label}</p>
        {insights.partial && <span className="partial-badge">Partial data</span>}
        <progress className="budget-progress" max="100" value={Math.min(percent, 100)}>
          {Math.min(percent, 100)}%
        </progress>
      </div>

      <section className="forecast-summary" aria-labelledby="usage-forecast-heading">
        <div className="forecast-heading">
          <h3 id="usage-forecast-heading">Usage forecast</h3>
          <p className={`forecast-status ${forecastStatusClasses[forecast.status]}`}>
            {forecastStatusLabels[forecast.status]}
          </p>
        </div>
        <div className="forecast-metrics">
          <div>
            <span>Projected total</span>
            <strong>{formatProjectedValue(forecast, forecast.projectedTotal)}</strong>
          </div>
          <div>
            <span>Projected budget usage</span>
            <strong>{formatProjectedPercent(forecast)}</strong>
          </div>
          <div>
            <span>
              Recommended per remaining {forecast.allowanceUnit}
            </span>
            <strong>
              {forecast.recommendedAllowance == null
                ? "—"
                : `${forecast.quality === "partial" ? "≤" : ""}${numberFormatter.format(
                  Math.round(forecast.recommendedAllowance)
                )}`}
            </strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{confidenceLabel(forecast.confidence)}</strong>
          </div>
        </div>
      </section>

      {editing && (
        <div className="budget-editor">
          {budgetKeys.map((key) => (
            <label key={key}>
              <span>{periodLabels[key]}</span>
              <input
                inputMode="numeric"
                value={values[key]}
                aria-invalid={Boolean(errors[key])}
                onChange={(event) => setValues((current) => ({
                  ...current,
                  [key]: event.target.value
                }))}
              />
              {errors[key] && <small role="alert">{errors[key]}</small>}
            </label>
          ))}
          {saveError && <p className="budget-save-error" role="alert">{saveError}</p>}
          <div className="budget-editor-actions">
            <button
              className="secondary-button budget-save"
              type="button"
              disabled={saveState === "saving"}
              onClick={submit}
            >
              {saveState === "saving" ? "Saving…" : "Save"}
            </button>
            <button className="secondary-button" type="button" onClick={() => {
              resetEditor();
              setEditing(false);
            }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="contributors-grid">
        <ContributorGroup title="Sources" items={insights.contributors.sources} />
        <ContributorGroup title="Projects" items={insights.contributors.projects} />
        <ContributorGroup title="Models" items={insights.contributors.models} />
      </div>

      <div className="heavy-turns">
        <h3>Unusually Heavy Turns</h3>
        {insights.heavyTurns.length === 0 ? (
          <p className="empty-copy">
            {insights.hasComparableHistory
              ? "No unusually heavy turns in this period"
              : "Not enough history yet"}
          </p>
        ) : (
          <ol className="heavy-turn-list">{insights.heavyTurns.map((turn) => {
            const projectPath = turn.project?.trim();
            return (
              <li key={turn.turnId}>
                <strong>{turn.prompt.trim() || "Prompt unavailable"}</strong>
                <span>
                  {sourceLabels[turn.source]} · {turn.model} ·{" "}
                  <AccessiblePath
                    label={projectPathLabel(turn.project)}
                    fullPath={projectPath || undefined}
                  />
                </span>
                <span className={turn.quality === "estimated" ? "estimated" : undefined}>
                  {numberFormatter.format(turn.total)} tokens
                  {turn.quality === "estimated" ? " (estimated)" : ""}
                  {" · "}<span>{turn.multiplier.toFixed(1)}× your recent median</span>
                </span>
                <small>{turn.baselineScope === "source-model" ? "Same source and model" : "Same source"}</small>
              </li>
            );
          })}</ol>
        )}
      </div>
    </section>
  );
}
