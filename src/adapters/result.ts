import type {
  ImportIssue,
  ImportResult,
  NormalizedSession,
  NormalizedTurn,
  Source
} from "../domain/types.js";

export function importResult(
  source: Source,
  sessions: NormalizedSession[],
  turns: NormalizedTurn[],
  issues: ImportIssue[],
  complete: boolean
): ImportResult {
  return {
    source,
    complete,
    sessions,
    turns,
    seenSessionIds: sessions.map((session) => session.sourceSessionId),
    issues,
    checkpoint: {
      completedAt: new Date().toISOString(),
      fingerprints: Object.fromEntries(
        sessions.map((session) => [session.sourceSessionId, session.fingerprint])
      )
    }
  };
}

