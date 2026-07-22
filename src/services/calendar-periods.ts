import type { UsageGranularity } from "../shared/dashboard.js";

export interface CalendarPeriod {
  start: Date;
  nextStart: Date;
  startDate: string;
  endDate: string;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfPeriod(granularity: UsageGranularity, date: Date): Date {
  const day = startOfLocalDay(date);
  if (granularity === "daily") return day;
  if (granularity === "weekly") return addLocalDays(day, -((day.getDay() + 6) % 7));
  return new Date(day.getFullYear(), day.getMonth(), 1);
}

function shiftPeriod(granularity: UsageGranularity, start: Date, amount: number): Date {
  if (granularity === "daily") return addLocalDays(start, amount);
  if (granularity === "weekly") return addLocalDays(start, amount * 7);
  return new Date(start.getFullYear(), start.getMonth() + amount, 1);
}

function toCalendarPeriod(granularity: UsageGranularity, start: Date): CalendarPeriod {
  const nextStart = shiftPeriod(granularity, start, 1);
  return {
    start,
    nextStart,
    startDate: dateKey(start),
    endDate: dateKey(addLocalDays(nextStart, -1))
  };
}

export function currentCalendarPeriod(
  granularity: UsageGranularity,
  now = new Date()
): CalendarPeriod {
  return toCalendarPeriod(granularity, startOfPeriod(granularity, now));
}

export function calendarPeriods(
  granularity: UsageGranularity,
  count: number,
  now = new Date()
): CalendarPeriod[] {
  const currentStart = startOfPeriod(granularity, now);
  return Array.from({ length: count }, (_, index) =>
    toCalendarPeriod(granularity, shiftPeriod(granularity, currentStart, index - count + 1))
  );
}
