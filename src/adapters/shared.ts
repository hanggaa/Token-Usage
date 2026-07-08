import { createHash } from "node:crypto";
import type { NormalizedSession, NormalizedTurn } from "../domain/types.js";

export interface ParsedSession {
  session: NormalizedSession;
  turns: NormalizedTurn[];
}

export function parseJsonLines(content: string): unknown[] {
  const rows: unknown[] = [];
  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Individual malformed lines are intentionally ignored by pure parsers.
    }
  }
  return rows;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function toIso(value: unknown): string | null {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  return null;
}

export function textPreview(text: string, fallback: string): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (!compact) {
    return fallback;
  }
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
}

