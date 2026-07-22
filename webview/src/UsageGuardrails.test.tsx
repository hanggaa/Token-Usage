// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PeriodInsights } from "../../src/shared/dashboard.js";
import { UsageGuardrails, type UsageGuardrailsProps } from "./UsageGuardrails.js";

const baseInsights: PeriodInsights = {
  startDate: "2026-07-22",
  endDate: "2026-07-22",
  total: 800,
  partial: false,
  contributors: {
    sources: [{ key: "codex", label: "Codex", tokens: 800, share: 1, partial: false }],
    projects: [{ key: "/work/app", label: "app", fullLabel: "/work/app", tokens: 800, share: 1, partial: false }],
    models: [{ key: "gpt-5", label: "gpt-5", tokens: 800, share: 1, partial: false }]
  },
  heavyTurns: [{
    turnId: "heavy",
    prompt: "Investigate import health",
    source: "codex",
    model: "gpt-5",
    project: "/work/app",
    total: 230,
    quality: "exact",
    baselineMedian: 100,
    multiplier: 2.3,
    baselineScope: "source-model"
  }],
  hasComparableHistory: true
};

afterEach(cleanup);

function renderGuardrails(options: {
  budget?: number;
  used?: number;
  partial?: boolean;
  insights?: Partial<PeriodInsights>;
  props?: Partial<UsageGuardrailsProps>;
} = {}) {
  const onSave = vi.fn();
  const onSaveSettled = vi.fn();
  const props: UsageGuardrailsProps = {
    granularity: "daily",
    budgets: { daily: options.budget ?? 1_000, weekly: 5_000, monthly: 20_000 },
    insights: {
      ...baseInsights,
      total: options.used ?? baseInsights.total,
      partial: options.partial ?? baseInsights.partial,
      ...options.insights
    },
    saveState: "idle",
    saveError: null,
    onSave,
    onSaveSettled,
    ...options.props
  };
  return { ...render(<UsageGuardrails {...props} />), props, onSave, onSaveSettled };
}

it.each([
  [79, "On track"],
  [80, "Approaching limit"],
  [99, "Approaching limit"],
  [100, "Budget exceeded"]
])("maps %s percent to %s", (used, status) => {
  renderGuardrails({ budget: 100, used });
  expect(screen.getByText(status)).toBeInTheDocument();
});

it("shows lower-bound budget usage, contributor paths, and heavy turn evidence", () => {
  renderGuardrails({ partial: true });
  expect(screen.getByText(/≥800/u)).toBeInTheDocument();
  expect(screen.getByText("Partial data")).toBeInTheDocument();
  const projects = screen.getByRole("heading", { name: "Projects" }).closest("div")!;
  const contributor = within(projects).getByText("app");
  expect(contributor).toHaveAccessibleName("app");
  expect(contributor).toHaveAccessibleDescription("/work/app");
  expect(contributor).toHaveAttribute("title", "/work/app");
  expect(screen.getByText("2.3× your recent median")).toBeInTheDocument();
  expect(screen.getByText("Same source and model")).toBeInTheDocument();
});

it("shows a heavy-turn project basename while retaining its full path metadata", () => {
  const fullPath = "/Users/demo/work/token-usage";
  renderGuardrails({
    insights: {
      heavyTurns: [{ ...baseInsights.heavyTurns[0], project: fullPath }]
    }
  });

  const project = screen.getByText("token-usage");
  expect(project).toHaveAttribute("title", fullPath);
  expect(project).toHaveAccessibleName("token-usage");
  expect(project).toHaveAccessibleDescription(fullPath);
  expect(screen.getByText(fullPath)).toHaveClass("sr-only");
});

it.each([
  ["C:\\Users\\demo\\work\\token-usage", "token-usage", "C:\\Users\\demo\\work\\token-usage"],
  ["", "Unknown", ""],
  [undefined, "Unknown", ""]
])("labels heavy-turn project %s as %s", (project, label, description) => {
  renderGuardrails({
    insights: {
      heavyTurns: [{
        ...baseInsights.heavyTurns[0],
        project: project as string
      }]
    }
  });

  const element = screen.getByText(label);
  expect(element).toHaveAccessibleName(label);
  if (description) expect(element).toHaveAccessibleDescription(description);
  else expect(element).not.toHaveAttribute("aria-describedby");
});

it("uses unique descriptions while preserving contributor and heavy-turn basenames", () => {
  const fullPath = "/Users/demo/work/token-usage";
  renderGuardrails({
    insights: {
      contributors: {
        ...baseInsights.contributors,
        projects: [
          { key: "first", label: "token-usage", fullLabel: fullPath, tokens: 500, share: 0.625, partial: false },
          { key: "second", label: "api", fullLabel: "/Users/demo/work/api", tokens: 300, share: 0.375, partial: false }
        ]
      },
      heavyTurns: [{ ...baseInsights.heavyTurns[0], project: fullPath }]
    }
  });

  const described = screen.getAllByText("token-usage");
  const descriptionIds = described.map((element) => element.getAttribute("aria-describedby"));
  expect(descriptionIds.every(Boolean)).toBe(true);
  expect(new Set(descriptionIds).size).toBe(descriptionIds.length);
  for (const element of described) {
    expect(element).toHaveAccessibleName("token-usage");
    expect(element).toHaveAccessibleDescription(fullPath);
  }
});

it("preserves Windows and Unknown contributor accessible names", () => {
  const windowsPath = "C:\\Users\\demo\\work\\token-usage";
  renderGuardrails({
    insights: {
      contributors: {
        ...baseInsights.contributors,
        projects: [
          { key: "windows", label: "token-usage", fullLabel: windowsPath, tokens: 500, share: 0.625, partial: false },
          { key: "unknown", label: "Unknown", tokens: 300, share: 0.375, partial: false }
        ]
      },
      heavyTurns: []
    }
  });

  const windowsProject = screen.getByText("token-usage");
  expect(windowsProject).toHaveAccessibleName("token-usage");
  expect(windowsProject).toHaveAccessibleDescription(windowsPath);
  const unknownProject = screen.getByText("Unknown");
  expect(unknownProject).toHaveAccessibleName("Unknown");
  expect(unknownProject).not.toHaveAttribute("aria-describedby");
});

it("keeps contributors visible when the budget is disabled", () => {
  renderGuardrails({ budget: 0 });
  expect(screen.getByText("No budget set")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set token budget" })).toBeInTheDocument();
  expect(screen.getByText("Codex")).toBeInTheDocument();
});

it("floors remaining tokens at zero after exceeding", () => {
  renderGuardrails({ budget: 100, used: 125 });
  const remaining = screen.getByText("Remaining").parentElement!;
  expect(within(remaining).getByText("0")).toBeInTheDocument();
});

it("renders contributor and heavy-turn empty states", () => {
  const { rerender, props } = renderGuardrails({
    insights: {
      contributors: { sources: [], projects: [], models: [] },
      heavyTurns: [],
      hasComparableHistory: false
    }
  });
  expect(screen.getAllByText("No usage in this period")).toHaveLength(3);
  expect(screen.getByText("Not enough history yet")).toBeInTheDocument();

  rerender(<UsageGuardrails {...props} insights={{
    ...props.insights,
    contributors: { sources: [], projects: [], models: [] },
    heavyTurns: [],
    hasComparableHistory: true
  }} />);
  expect(screen.getByText("No unusually heavy turns in this period")).toBeInTheDocument();
});

it("opens initialized inputs, normalizes blank, and saves all budgets once", () => {
  const { onSave } = renderGuardrails();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  expect(screen.getByLabelText("Daily")).toHaveValue("1000");
  expect(screen.getByLabelText("Weekly")).toHaveValue("5000");
  expect(screen.getByLabelText("Monthly")).toHaveValue("20000");
  fireEvent.change(screen.getByLabelText("Daily"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Weekly"), { target: { value: "2500" } });
  fireEvent.change(screen.getByLabelText("Monthly"), { target: { value: "9000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(onSave).toHaveBeenCalledWith({ daily: 0, weekly: 2_500, monthly: 9_000 });
});

it.each(["-1", "1.5", "abc", String(Number.MAX_SAFE_INTEGER + 1)])(
  "rejects invalid editor value %s",
  (value) => {
    const { onSave } = renderGuardrails();
    fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
    fireEvent.change(screen.getByLabelText("Daily"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a whole, non-negative number.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  }
);

it("cancels edits and restores saved values on reopen", () => {
  renderGuardrails();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  fireEvent.change(screen.getByLabelText("Daily"), { target: { value: "77" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("Daily")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  expect(screen.getByLabelText("Daily")).toHaveValue("1000");
});

it("disables Save while saving and preserves edits after an error", () => {
  const view = renderGuardrails();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  fireEvent.change(screen.getByLabelText("Daily"), { target: { value: "77" } });
  view.rerender(<UsageGuardrails {...view.props} saveState="saving" />);
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  view.rerender(<UsageGuardrails {...view.props} saveState="error" saveError="Could not save budgets" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save budgets");
  expect(screen.getByLabelText("Daily")).toHaveValue("77");
});

it("closes and settles only after the saved acknowledgement", () => {
  const view = renderGuardrails();
  fireEvent.click(screen.getByRole("button", { name: "Edit budgets" }));
  view.rerender(<UsageGuardrails {...view.props} saveState="saved" />);
  expect(screen.queryByLabelText("Daily")).not.toBeInTheDocument();
  expect(view.onSaveSettled).toHaveBeenCalledOnce();
});
