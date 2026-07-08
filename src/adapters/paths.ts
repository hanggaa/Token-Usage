import { join } from "node:path";

export interface SourcePaths {
  codex: string;
  opencode: string;
  antigravityCurrent: string;
  antigravityLegacy: string;
}

export function resolveSourcePaths(home: string): SourcePaths {
  return {
    codex: join(home, ".codex", "sessions"),
    opencode: join(home, ".local", "share", "opencode"),
    antigravityCurrent: join(home, ".gemini", "antigravity-ide"),
    antigravityLegacy: join(home, ".gemini", "antigravity")
  };
}

