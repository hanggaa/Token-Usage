import { afterEach, describe, expect, it } from "vitest";
import {
  addLocalDays,
  calendarPeriods,
  currentCalendarPeriod
} from "../../src/services/calendar-periods.js";

const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone == null) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe("calendar periods", () => {
  it("builds current daily, Monday-based weekly, and monthly periods", () => {
    const now = new Date(2026, 6, 22, 12);
    expect(currentCalendarPeriod("daily", now)).toMatchObject({
      startDate: "2026-07-22", endDate: "2026-07-22"
    });
    expect(currentCalendarPeriod("weekly", now)).toMatchObject({
      startDate: "2026-07-20", endDate: "2026-07-26"
    });
    expect(currentCalendarPeriod("monthly", now)).toMatchObject({
      startDate: "2026-07-01", endDate: "2026-07-31"
    });
  });

  it("returns ordered period collections including the current period", () => {
    const periods = calendarPeriods("weekly", 12, new Date(2026, 6, 22, 12));
    expect(periods).toHaveLength(12);
    expect(periods[0].start.valueOf()).toBeLessThan(periods[1].start.valueOf());
    expect(periods.at(-1)).toMatchObject({ startDate: "2026-07-20" });
  });

  it("reconstructs local day boundaries through midnight DST changes", () => {
    process.env.TZ = "America/Santiago";
    const transitionDay = new Date(2026, 8, 6);
    const nextDay = addLocalDays(transitionDay, 1);
    expect(nextDay.getFullYear()).toBe(2026);
    expect(nextDay.getMonth()).toBe(8);
    expect(nextDay.getDate()).toBe(7);
    expect(nextDay.getHours()).toBe(0);
  });
});
