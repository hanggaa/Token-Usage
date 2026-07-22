import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import {
  useDeferredValue,
  useMemo,
  useState
} from "react";
import type { CSSProperties } from "react";
import type {
  MeasurementQuality,
  NormalizedTurn,
  Source,
  TokenKind,
  TokenMetric
} from "../../src/domain/types.js";
import {
  SOURCES,
  type DashboardSnapshot,
  type TrendPoint,
  type UsageBudgets,
  type UsageGranularity,
  type UsageSummary
} from "../../src/shared/dashboard.js";
import { UsageGuardrails, type BudgetSaveState } from "./UsageGuardrails.js";
import "./styles.css";

interface AppProps {
  snapshot: DashboardSnapshot;
  loading: boolean;
  onRefresh: () => void;
  usageGranularity: UsageGranularity;
  onUsageGranularityChange: (granularity: UsageGranularity) => void;
  budgetSaveState: BudgetSaveState;
  budgetSaveError: string | null;
  onSaveBudgets: (budgets: UsageBudgets) => void;
  onBudgetSaveSettled: () => void;
}

const SOURCE_LABELS: Record<Source, string> = {
  codex: "Codex",
  opencode: "OpenCode",
  antigravity: "Antigravity"
};

const GRANULARITY_LABELS: Record<UsageGranularity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly"
};

const METRIC_LABELS: Record<TokenKind, string> = {
  typed_input: "Typed input",
  request_input: "Request input",
  cached_input: "Cached input",
  output: "Output",
  reasoning_output: "Reasoning output",
  total: "Total"
};

const numberFormatter = new Intl.NumberFormat();
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
});
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric"
});
const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric"
});
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1
});

function parseCalendarDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function formatAxisLabel(granularity: UsageGranularity, point: TrendPoint): string {
  const start = parseCalendarDate(point.startDate);
  const end = parseCalendarDate(point.endDate);
  if (granularity === "daily") {
    return shortDateFormatter.format(start);
  }
  if (granularity === "monthly") {
    return monthYearFormatter.format(start);
  }
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${monthFormatter.format(start)} ${start.getDate()}–${end.getDate()}`;
  }
  return `${shortDateFormatter.format(start)}–${shortDateFormatter.format(end)}`;
}

function formatFullPeriod(point: TrendPoint): string {
  const start = parseCalendarDate(point.startDate);
  const end = parseCalendarDate(point.endDate);
  if (point.startDate === point.endDate) {
    return fullDateFormatter.format(start);
  }
  return `${fullDateFormatter.format(start)}–${fullDateFormatter.format(end)}`;
}

function formatTooltip(point: TrendPoint): string {
  const total = SOURCES.reduce((sum, source) => sum + (point[source] ?? 0), 0);
  return [
    formatFullPeriod(point),
    `Total: ${numberFormatter.format(total)}`,
    ...SOURCES.map((source) =>
      `${SOURCE_LABELS[source]}: ${
        point[source] == null ? "Unavailable" : numberFormatter.format(point[source])
      }`
    ),
    ...(point.inProgress ? ["In progress"] : [])
  ].join("\n");
}

function formatMetric(metric?: TokenMetric): string {
  if (!metric || metric.value == null) {
    return "—";
  }
  const prefix =
    metric.quality === "partial" ? "≥" : metric.quality === "estimated" ? "≈" : "";
  return `${prefix}${numberFormatter.format(metric.value)}`;
}

function metricFor(turn: NormalizedTurn, kind: TokenKind): TokenMetric | undefined {
  return turn.metrics.find((metric) => metric.kind === kind);
}

function projectName(project: string | null): string {
  if (!project) {
    return "—";
  }
  const parts = project.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) ?? project;
}

function SummaryCard({
  label,
  summary,
  accent
}: {
  label: string;
  summary: UsageSummary;
  accent: "codex" | "opencode" | "antigravity";
}) {
  const exactPercent = summary.total > 0 ? (summary.exact / summary.total) * 100 : 0;
  const estimatedPercent = summary.total > 0 ? (summary.estimated / summary.total) * 100 : 0;
  const partialPercent = summary.total > 0 ? (summary.partial / summary.total) * 100 : 0;
  return (
    <section className={`summary-card accent-${accent}`}>
      <p className="summary-label">{label}</p>
      <div className="summary-value">
        {summary.partial > 0 ? "≥" : ""}
        {numberFormatter.format(summary.total)}
        <span>tokens</span>
      </div>
      <div className="summary-split">
        <span className="exact">
          Exact: {numberFormatter.format(summary.exact)} ({exactPercent.toFixed(1)}%)
        </span>
        <span>
          Estimated: {numberFormatter.format(summary.estimated)} ({estimatedPercent.toFixed(1)}%)
        </span>
        <span className="partial">
          Lower bound: {numberFormatter.format(summary.partial)} ({partialPercent.toFixed(1)}%)
        </span>
      </div>
    </section>
  );
}

function AggregationSelector({
  value,
  onChange
}: {
  value: UsageGranularity;
  onChange: (granularity: UsageGranularity) => void;
}) {
  return (
    <fieldset className="aggregation-selector" aria-label="Usage aggregation">
      <legend className="sr-only">Usage aggregation</legend>
      {(Object.keys(GRANULARITY_LABELS) as UsageGranularity[]).map((granularity) => (
        <label key={granularity}>
          <input
            type="radio"
            name="usage-aggregation"
            value={granularity}
            checked={value === granularity}
            onChange={() => onChange(granularity)}
          />
          <span>{GRANULARITY_LABELS[granularity]}</span>
        </label>
      ))}
    </fieldset>
  );
}

function TrendChart({
  snapshot,
  usageGranularity,
  onUsageGranularityChange
}: {
  snapshot: DashboardSnapshot;
  usageGranularity: UsageGranularity;
  onUsageGranularityChange: (granularity: UsageGranularity) => void;
}) {
  const points = snapshot.trends[usageGranularity];
  const maximum = Math.max(
    1,
    ...points.map((point) =>
      SOURCES.reduce((sum, source) => sum + (point[source] ?? 0), 0)
    )
  );
  return (
    <section className="panel trend-panel">
      <header className="panel-heading">
        <h2>Usage Over Time</h2>
        <div className="trend-controls">
          <AggregationSelector value={usageGranularity} onChange={onUsageGranularityChange} />
          <div className="legend" aria-label="Chart legend">
            {SOURCES.map((source) => (
              <span key={source}>
                <i className={`source-dot source-${source}`} />
                {SOURCE_LABELS[source]}
              </span>
            ))}
          </div>
        </div>
      </header>
      <div
        className="chart"
        role="img"
        aria-label={`${GRANULARITY_LABELS[usageGranularity]} token usage by source`}
        style={{ "--bucket-count": points.length } as CSSProperties}
      >
        <div className="y-axis" aria-hidden="true">
          {[1, 0.75, 0.5, 0.25].map((fraction) => (
            <span key={fraction}>{compactNumberFormatter.format(Math.round(maximum * fraction))}</span>
          ))}
        </div>
        <div className="chart-grid">
          <span />
          <span />
          <span />
          <span />
        </div>
        {points.map((point) => {
          return (
            <div
              className={`chart-column ${point.inProgress ? "in-progress" : ""}`}
              key={`${usageGranularity}:${point.startDate}`}
              title={formatTooltip(point)}
            >
              <div className="bar-track">
                {SOURCES.map((source) => {
                  const value = point[source] ?? 0;
                  return (
                    <div
                      key={source}
                      className={`bar-segment source-${source} ${
                        point.partialSources?.includes(source) ? "bar-partial" : ""
                      }`}
                      style={{ height: `${(value / maximum) * 100}%` }}
                    />
                  );
                })}
              </div>
              <span>{formatAxisLabel(usageGranularity, point)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ImportHealth({ snapshot }: { snapshot: DashboardSnapshot }) {
  const bySource = new Map(snapshot.health.map((health) => [health.source, health]));
  const antigravity = bySource.get("antigravity");
  const legacyIssues =
    antigravity?.issues.filter((issue) => /legacy|language server/iu.test(issue.message)) ?? [];
  return (
    <section className="panel health-panel">
      <header className="panel-heading">
        <h2>Import Health</h2>
      </header>
      <div className="health-list">
        {SOURCES.map((source) => {
          const health = bySource.get(source);
          const healthy =
            health?.complete === true ||
            (source === "antigravity" &&
              (health?.turnCount ?? 0) > 0 &&
              legacyIssues.length === health?.issues.length);
          return (
            <div className="health-row" key={source}>
              <span>
                <i className={`health-dot ${healthy ? "healthy" : "warning"}`} />
                {SOURCE_LABELS[source]} {source === "codex" || source === "opencode" ? "CLI" : "IDE"}
              </span>
              <strong className={healthy ? "healthy-text" : "warning-text"}>
                {health ? (healthy ? "Healthy" : "Needs attention") : "Not scanned"}
              </strong>
            </div>
          );
        })}
        {legacyIssues.length > 0 ? (
          <div className="health-row">
            <span>
              <i className="health-dot warning" />
              Legacy Session Import
            </span>
            <strong className="warning-text">Unavailable</strong>
          </div>
        ) : null}
      </div>
      <p className="health-note">
        {snapshot.health.reduce((sum, health) => sum + health.issues.length, 0)} import issues
      </p>
    </section>
  );
}

function Quality({ turn }: { turn: NormalizedTurn }) {
  const quality = metricFor(turn, "total")?.quality ?? "unavailable";
  return (
    <span
      className={`quality quality-${quality}`}
      title={
        quality === "unavailable"
          ? "Total unavailable"
          : quality === "partial"
            ? "Lower bound from observable local context"
            : quality
      }
    >
      {quality === "unavailable" ? "—" : quality}
    </span>
  );
}

function TurnDetails({
  turn,
  onClose
}: {
  turn: NormalizedTurn;
  onClose: () => void;
}) {
  return (
    <aside className="detail-panel" aria-label="Turn details">
      <header className="detail-header">
        <span>{timeFormatter.format(new Date(turn.timestamp))}</span>
        <i className={`source-dot source-${turn.source}`} />
        <span>{SOURCE_LABELS[turn.source]}</span>
        <span>•</span>
        <span>{turn.model ?? "Unknown model"}</span>
        <span>•</span>
        <span>{projectName(turn.project)}</span>
        <button
          className="detail-close"
          type="button"
          aria-label="Close turn details"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      <section>
        <h3>Prompt</h3>
        <pre>{turn.prompt || "Prompt text retention is disabled."}</pre>
      </section>
      <section>
        <h3>Response (preview)</h3>
        <pre>{turn.response || "Response text retention is disabled."}</pre>
      </section>
      <section>
        <h3>Token breakdown</h3>
        <div className="metric-list">
          {turn.metrics.map((metric) => (
            <div className="metric-row" key={metric.kind} title={metric.basis}>
              <span>{METRIC_LABELS[metric.kind]}</span>
              <strong>{formatMetric(metric)}</strong>
              <small>{metric.quality}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="session-details">
        <h3>Session details</h3>
        <dl>
          <dt>Session ID</dt>
          <dd>{turn.sourceSessionId}</dd>
          <dt>Turn ID</dt>
          <dd>{turn.sourceTurnId}</dd>
          <dt>Tool events</dt>
          <dd>{turn.toolEventCount}</dd>
          <dt>Imported source</dt>
          <dd>{SOURCE_LABELS[turn.source]}</dd>
        </dl>
      </section>
    </aside>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="select-wrap">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function App({
  snapshot,
  loading,
  onRefresh,
  usageGranularity,
  onUsageGranularityChange,
  budgetSaveState,
  budgetSaveError,
  onSaveBudgets,
  onBudgetSaveSettled
}: AppProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [source, setSource] = useState("all");
  const [model, setModel] = useState("all");
  const [project, setProject] = useState("all");
  const [quality, setQuality] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.turns[0]?.id ?? null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const options = useMemo(
    () => ({
      models: [...new Set(snapshot.turns.map((turn) => turn.model).filter(Boolean))].toSorted(),
      projects: [...new Set(snapshot.turns.map((turn) => turn.project).filter(Boolean))].toSorted()
    }),
    [snapshot.turns]
  );

  const filteredTurns = useMemo(() => {
    const needle = deferredSearch.trim().toLocaleLowerCase();
    return snapshot.turns.filter((turn) => {
      const totalQuality = metricFor(turn, "total")?.quality ?? "unavailable";
      return (
        (source === "all" || turn.source === source) &&
        (model === "all" || turn.model === model) &&
        (project === "all" || turn.project === project) &&
        (quality === "all" || totalQuality === quality) &&
        (!needle ||
          turn.prompt.toLocaleLowerCase().includes(needle) ||
          turn.response.toLocaleLowerCase().includes(needle))
      );
    });
  }, [deferredSearch, model, project, quality, snapshot.turns, source]);

  const maxPage = Math.max(0, Math.ceil(filteredTurns.length / pageSize) - 1);
  const safePage = Math.min(page, maxPage);
  const pageTurns = filteredTurns.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const selected = detailsOpen
    ? filteredTurns.find((turn) => turn.id === selectedId) ?? filteredTurns[0] ?? null
    : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1>Token Usage</h1>
        <div>
          <span>
            Last refreshed: {timeFormatter.format(new Date(snapshot.generatedAt))}
          </span>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <section className="summary-grid">
        <SummaryCard label="Today" summary={snapshot.summaries.today} accent="codex" />
        <SummaryCard label="Last 7 Days" summary={snapshot.summaries.sevenDays} accent="opencode" />
        <SummaryCard label="All Time" summary={snapshot.summaries.allTime} accent="antigravity" />
      </section>

      <section className="analytics-grid">
        <TrendChart
          snapshot={snapshot}
          usageGranularity={usageGranularity}
          onUsageGranularityChange={onUsageGranularityChange}
        />
        <ImportHealth snapshot={snapshot} />
      </section>

      <UsageGuardrails
        granularity={usageGranularity}
        budgets={snapshot.budgets}
        insights={snapshot.insights[usageGranularity]}
        saveState={budgetSaveState}
        saveError={budgetSaveError}
        onSave={onSaveBudgets}
        onSaveSettled={onBudgetSaveSettled}
      />

      <section className={`workspace ${selected ? "" : "detail-closed"}`}>
        <div className="turns-panel">
          <div className="filters">
            <label className="search-box">
              <Search size={15} />
              <span className="sr-only">Search prompts</span>
              <input
                placeholder="Search prompts"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <SelectFilter label="Source" value={source} onChange={(value) => { setSource(value); setPage(0); }}>
              <option value="all">All sources</option>
              {SOURCES.map((item) => <option value={item} key={item}>{SOURCE_LABELS[item]}</option>)}
            </SelectFilter>
            <SelectFilter label="Model" value={model} onChange={(value) => { setModel(value); setPage(0); }}>
              <option value="all">All models</option>
              {options.models.map((item) => <option value={item!} key={item}>{item}</option>)}
            </SelectFilter>
            <SelectFilter label="Project" value={project} onChange={(value) => { setProject(value); setPage(0); }}>
              <option value="all">All projects</option>
              {options.projects.map((item) => <option value={item!} key={item}>{projectName(item)}</option>)}
            </SelectFilter>
            <SelectFilter label="Quality" value={quality} onChange={(value) => { setQuality(value); setPage(0); }}>
              <option value="all">Exact + estimated + partial</option>
              <option value="exact">Exact</option>
              <option value="estimated">Estimated</option>
              <option value="partial">Partial lower bound</option>
              <option value="unavailable">Unavailable</option>
            </SelectFilter>
          </div>

          <div className="table-scroller">
            <table aria-label="Token usage by turn">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Model</th>
                  <th>Project</th>
                  <th>Prompt</th>
                  <th>Typed input</th>
                  <th>Request input</th>
                  <th>Cached input</th>
                  <th>Output</th>
                  <th>Reasoning output</th>
                  <th>Total</th>
                  <th>Quality</th>
                </tr>
              </thead>
              <tbody>
                {pageTurns.map((turn) => (
                  <tr
                    key={turn.id}
                    className={selected?.id === turn.id ? "selected" : ""}
                    onClick={() => {
                      setSelectedId(turn.id);
                      setDetailsOpen(true);
                    }}
                  >
                    <td>{timeFormatter.format(new Date(turn.timestamp))}</td>
                    <td><i className={`source-dot source-${turn.source}`} />{SOURCE_LABELS[turn.source]}</td>
                    <td>{turn.model ?? "—"}</td>
                    <td>{projectName(turn.project)}</td>
                    <td className="prompt-cell">{turn.prompt || "Content not retained"}</td>
                    <td>{formatMetric(metricFor(turn, "typed_input"))}</td>
                    <td>{formatMetric(metricFor(turn, "request_input"))}</td>
                    <td>{formatMetric(metricFor(turn, "cached_input"))}</td>
                    <td>{formatMetric(metricFor(turn, "output"))}</td>
                    <td>{formatMetric(metricFor(turn, "reasoning_output"))}</td>
                    <td>{formatMetric(metricFor(turn, "total"))}</td>
                    <td><Quality turn={turn} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pageTurns.length === 0 ? (
              <p className="empty-state">No turns match the current filters.</p>
            ) : null}
          </div>

          <footer className="table-footer">
            <span>
              Showing {filteredTurns.length === 0 ? 0 : safePage * pageSize + 1}–
              {Math.min((safePage + 1) * pageSize, filteredTurns.length)} of {filteredTurns.length} turns
            </span>
            <div>
              <span>25 per page</span>
              <button
                aria-label="Previous page"
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft size={15} />
              </button>
              <strong>{safePage + 1}</strong>
              <button
                aria-label="Next page"
                type="button"
                disabled={safePage === maxPage}
                onClick={() => setPage((current) => Math.min(maxPage, current + 1))}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </footer>
        </div>
        {selected ? (
          <TurnDetails turn={selected} onClose={() => setDetailsOpen(false)} />
        ) : null}
      </section>
    </main>
  );
}
