---
type: "query"
date: "2026-07-22T06:05:52.252517+00:00"
question: "Here is the result operational40:Deep operational40$ which opencode /Users/operational40/.nvm/versions/node/v24.14.1/bin/opencode operational40:Deep operational40$ opencode --version 1.18.4"
contributor: "graphify"
outcome: "useful"
source_nodes: ["defaultOpenCodeExecutor", "firstExisting", "OpenCodeAdapter", "SourceAvailability", "scanDatabaseFallback"]
---

# Q: Here is the result operational40:Deep operational40$ which opencode /Users/operational40/.nvm/versions/node/v24.14.1/bin/opencode operational40:Deep operational40$ opencode --version 1.18.4

## Answer

Expanded from original query via graph vocabulary: [opencode, executor, existing, path, extension, detect, scan, configured, availability, error]. The terminal result proves OpenCode is installed and available to the interactive shell. Its location is inside a version-specific NVM directory. The graph shows defaultOpenCodeExecutor and firstExisting are responsible for executable discovery before OpenCodeAdapter detect and scan. Therefore the leading diagnosis is an environment PATH mismatch between the interactive terminal and the editor extension host. Fully quit the editor, launch it from the same terminal with code ., and refresh Token Usage. If health changes to Healthy, executable discovery is confirmed as the problem. If it remains Needs attention, inspect the Import Health detail because the next graph branch is scanDatabaseFallback, which checks the OpenCode database path and queries its rows.

## Outcome

- Signal: useful

## Source Nodes

- defaultOpenCodeExecutor
- firstExisting
- OpenCodeAdapter
- SourceAvailability
- scanDatabaseFallback