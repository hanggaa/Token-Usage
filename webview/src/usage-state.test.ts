import { describe, expect, it, vi } from "vitest";
import {
  readUsageGranularity,
  writeUsageGranularity
} from "./usage-state.js";

describe("usage aggregation webview state", () => {
  it("defaults missing and malformed values to daily", () => {
    expect(readUsageGranularity(undefined)).toBe("daily");
    expect(readUsageGranularity({})).toBe("daily");
    expect(readUsageGranularity({ usageGranularity: "yearly" })).toBe("daily");
    expect(readUsageGranularity({ usageGranularity: 12 })).toBe("daily");
  });

  it("restores every supported value", () => {
    expect(readUsageGranularity({ usageGranularity: "daily" })).toBe("daily");
    expect(readUsageGranularity({ usageGranularity: "weekly" })).toBe("weekly");
    expect(readUsageGranularity({ usageGranularity: "monthly" })).toBe("monthly");
  });

  it("stores only the selected usage granularity", () => {
    const setState = vi.fn();
    writeUsageGranularity({ setState }, "weekly");
    expect(setState).toHaveBeenCalledWith({ usageGranularity: "weekly" });
  });
});
