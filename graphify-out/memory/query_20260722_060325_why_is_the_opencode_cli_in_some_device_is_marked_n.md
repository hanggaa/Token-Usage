---
type: "query"
date: "2026-07-22T06:03:25.665308+00:00"
question: "Why is the Opencode CLI in some device is marked Needs attention? in my windows device is Healthy but in my MacOS device is Needs attention"
contributor: "graphify"
outcome: "useful"
source_nodes: ["OpenCodeAdapter", "SourceAvailability", "ImportResult", "SourceHealth", "ImportHealth", "defaultOpenCodeExecutor", "scanDatabaseFallback", "tokenUsage.paths.opencode"]
---

# Q: Why is the Opencode CLI in some device is marked Needs attention? in my windows device is Healthy but in my MacOS device is Needs attention

## Answer

Expanded from original query via graph vocabulary: [opencode, health, import, result, scan, path, source, status, session, file, error, detect, availability, exists, issue]. The OpenCode badge reflects source detection and the latest import result, not operating-system health. OpenCodeAdapter.detect and scan feed ImportResult into SourceHealth and then ImportHealth. The adapter first tries executable discovery through defaultOpenCodeExecutor and firstExisting, then scan can use scanDatabaseFallback with pathExists and queryRows. Therefore Windows Healthy means its OpenCode discovery/import path completed without a recorded issue, while macOS Needs attention means at least one discovery or scan route returned an issue. Likely Mac-specific causes are the VS Code extension host not seeing the OpenCode executable, or the expected/configured OpenCode database path being absent or unreadable. The graph does not contain the runtime issue text, so the precise Mac branch must be confirmed from the Import Health detail.

## Outcome

- Signal: useful

## Source Nodes

- OpenCodeAdapter
- SourceAvailability
- ImportResult
- SourceHealth
- ImportHealth
- defaultOpenCodeExecutor
- scanDatabaseFallback
- tokenUsage.paths.opencode