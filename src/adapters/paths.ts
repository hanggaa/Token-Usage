import { join } from "node:path";

export interface SourcePaths {
  codex: string;
  claude: string;
  opencode: string;
  antigravityCurrent: string;
  antigravityLegacy: string;
}

export function resolveSourcePaths(
  home: string,
  environment: NodeJS.ProcessEnv = process.env
): SourcePaths {
  const claudeConfigRoot = environment.CLAUDE_CONFIG_DIR?.trim()
    || join(home, ".claude");
  return {
    codex: join(home, ".codex", "sessions"),
    claude: join(claudeConfigRoot, "projects"),
    opencode: join(home, ".local", "share", "opencode"),
    antigravityCurrent: join(home, ".gemini", "antigravity-ide"),
    antigravityLegacy: join(home, ".gemini", "antigravity")
  };
}
