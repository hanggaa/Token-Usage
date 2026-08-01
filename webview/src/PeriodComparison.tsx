import { useState } from "react";
import type {
  ComparisonDimension,
  ComparisonMover,
  ComparisonUsage,
  PeriodComparison as PeriodComparisonData,
  UsageGranularity
} from "../../src/shared/dashboard.js";

export interface PeriodComparisonProps {
  comparison: PeriodComparisonData;
  granularity: UsageGranularity;
}

const numberFormatter = new Intl.NumberFormat();
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});
const GRANULARITY_LABELS: Record<UsageGranularity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly"
};
const DIMENSION_LABELS: Record<ComparisonDimension, string> = {
  sources: "Source",
  projects: "Project",
  models: "Model"
};

function formatUsage(usage: ComparisonUsage): string {
  if (usage.tokens == null) return "Unavailable";
  const prefix =
    usage.quality === "partial" ? "≥" : usage.quality === "estimated" ? "≈" : "";
  return `${prefix}${numberFormatter.format(usage.tokens)}`;
}

function formatSigned(value: number, approximate: boolean): string {
  const sign = value > 0 ? "+" : "";
  return `${approximate ? "≈" : ""}${sign}${numberFormatter.format(value)}`;
}

function changeLabel(comparison: PeriodComparisonData): string {
  if (comparison.kind === "unavailable") return "Not comparable";
  if (comparison.kind === "new") return "New usage";
  const delta = formatSigned(comparison.delta ?? 0, comparison.quality === "estimated");
  if (comparison.deltaPercent == null) return delta;
  const sign = comparison.deltaPercent > 0 ? "+" : "";
  return `${delta} (${sign}${comparison.deltaPercent.toFixed(1)}%)`;
}

function moverChange(mover: ComparisonMover): string {
  if (mover.kind === "new") return `New · ${formatSigned(mover.delta, mover.quality === "estimated")}`;
  if (mover.kind === "stopped") {
    return `${formatSigned(mover.delta, mover.quality === "estimated")} (-100.0%)`;
  }
  const percent =
    mover.deltaPercent == null
      ? ""
      : ` (${mover.deltaPercent > 0 ? "+" : ""}${mover.deltaPercent.toFixed(1)}%)`;
  return `${formatSigned(mover.delta, mover.quality === "estimated")}${percent}`;
}

function MoverList({
  heading,
  items,
  empty
}: {
  heading: string;
  items: ComparisonMover[];
  empty: string;
}) {
  return (
    <section className="comparison-movers">
      <h3>{heading}</h3>
      {items.length > 0 ? (
        <ol>
          {items.map((mover) => (
            <li key={mover.key} title={mover.fullLabel}>
              <span>
                <strong>{mover.label}</strong>
                <small>
                  {formatUsage(mover.previous)} → {formatUsage(mover.current)}
                </small>
              </span>
              <b className={mover.delta > 0 ? "comparison-up" : "comparison-down"}>
                {moverChange(mover)}
              </b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-copy">{empty}</p>
      )}
    </section>
  );
}

export function PeriodComparison({
  comparison,
  granularity
}: PeriodComparisonProps) {
  const [dimension, setDimension] = useState<ComparisonDimension>("sources");
  const movers = comparison.movers[dimension];
  return (
    <section className="comparison-panel" aria-labelledby="period-comparison-heading">
      <header className="comparison-heading">
        <div>
          <h2 id="period-comparison-heading">Period Comparison</h2>
          <p>
            {GRANULARITY_LABELS[granularity]} usage through{" "}
            {dateTimeFormatter.format(new Date(comparison.currentThrough))}, compared with the
            same calendar position in the previous period.
          </p>
        </div>
      </header>

      <div className="comparison-summary">
        <div>
          <span>Current period</span>
          <strong>{formatUsage(comparison.current)}</strong>
          <small>From {comparison.currentStartDate}</small>
        </div>
        <div>
          <span>Previous matched period</span>
          <strong>{formatUsage(comparison.previous)}</strong>
          <small>
            {comparison.previousStartDate} through{" "}
            {dateTimeFormatter.format(new Date(comparison.previousThrough))}
          </small>
        </div>
        <div>
          <span>Change</span>
          <strong className={
            comparison.kind === "increase" || comparison.kind === "new"
              ? "comparison-up"
              : comparison.kind === "decrease"
                ? "comparison-down"
                : ""
          }>
            {changeLabel(comparison)}
          </strong>
          <small>
            {comparison.quality === "partial"
              ? "Delta hidden because one period is a lower bound."
              : comparison.quality === "unavailable"
                ? "One period has no comparable total."
                : comparison.quality === "estimated"
                  ? "Includes estimated usage."
                  : "Comparable tracked usage."}
          </small>
        </div>
      </div>

      <div className="comparison-breakdown">
        <div className="comparison-tabs" role="group" aria-label="Comparison breakdown">
          {(Object.keys(DIMENSION_LABELS) as ComparisonDimension[]).map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={dimension === item}
              onClick={() => setDimension(item)}
            >
              {DIMENSION_LABELS[item]}
            </button>
          ))}
        </div>
        <div className="comparison-mover-grid">
          <MoverList
            heading="Top increases"
            items={movers.increases}
            empty="No comparable increases."
          />
          <MoverList
            heading="Top decreases"
            items={movers.decreases}
            empty="No comparable decreases."
          />
        </div>
        {movers.omittedCount > 0 ? (
          <p className="comparison-omitted">
            {movers.omittedCount} {DIMENSION_LABELS[dimension].toLowerCase()}
            {movers.omittedCount === 1 ? "" : "s"} omitted because partial or unavailable
            usage cannot produce a reliable delta.
          </p>
        ) : null}
      </div>
    </section>
  );
}
