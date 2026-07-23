# Graph Report - .  (2026-07-22)

## Corpus Check
- 57 files · ~106,846 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 485 nodes · 816 edges · 45 communities (37 shown, 8 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.83)
- Token cost: 2,545 input · 3,990 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Extension Import Pipeline|Extension Import Pipeline]]
- [[_COMMUNITY_Product Documentation Rationale|Product Documentation Rationale]]
- [[_COMMUNITY_Source Transcript Parsers|Source Transcript Parsers]]
- [[_COMMUNITY_Dashboard Data Store|Dashboard Data Store]]
- [[_COMMUNITY_Webview Messaging Bridge|Webview Messaging Bridge]]
- [[_COMMUNITY_React Dashboard UI|React Dashboard UI]]
- [[_COMMUNITY_Webview TypeScript Config|Webview TypeScript Config]]
- [[_COMMUNITY_Mobile Dashboard Design|Mobile Dashboard Design]]
- [[_COMMUNITY_Development Dependencies|Development Dependencies]]
- [[_COMMUNITY_Extension TypeScript Config|Extension TypeScript Config]]
- [[_COMMUNITY_Dashboard Implementation Visual|Dashboard Implementation Visual]]
- [[_COMMUNITY_VS Code Extension Manifest|VS Code Extension Manifest]]
- [[_COMMUNITY_Desktop Dashboard Concept|Desktop Dashboard Concept]]
- [[_COMMUNITY_Visual QA Automation|Visual QA Automation]]
- [[_COMMUNITY_Build and Test Scripts|Build and Test Scripts]]
- [[_COMMUNITY_Raster Avatar Icon|Raster Avatar Icon]]
- [[_COMMUNITY_Activity Bar Contributions|Activity Bar Contributions]]
- [[_COMMUNITY_Antigravity Legacy Bridge|Antigravity Legacy Bridge]]
- [[_COMMUNITY_Vector Character Icon|Vector Character Icon]]
- [[_COMMUNITY_Storage Configuration|Storage Configuration]]
- [[_COMMUNITY_Runtime Dependencies|Runtime Dependencies]]
- [[_COMMUNITY_Refresh Interval Settings|Refresh Interval Settings]]
- [[_COMMUNITY_Background Refresh Scheduler|Background Refresh Scheduler]]
- [[_COMMUNITY_Prompt Retention Settings|Prompt Retention Settings]]
- [[_COMMUNITY_Background Refresh Toggle|Background Refresh Toggle]]
- [[_COMMUNITY_Antigravity Path Setting|Antigravity Path Setting]]
- [[_COMMUNITY_Codex Path Setting|Codex Path Setting]]
- [[_COMMUNITY_OpenCode Path Setting|OpenCode Path Setting]]
- [[_COMMUNITY_Antigravity Source Toggle|Antigravity Source Toggle]]
- [[_COMMUNITY_Codex Source Toggle|Codex Source Toggle]]
- [[_COMMUNITY_OpenCode Source Toggle|OpenCode Source Toggle]]
- [[_COMMUNITY_Icon Rendering Script|Icon Rendering Script]]
- [[_COMMUNITY_Repository Metadata|Repository Metadata]]
- [[_COMMUNITY_Build Automation|Build Automation]]
- [[_COMMUNITY_Activity Bar Icon|Activity Bar Icon]]
- [[_COMMUNITY_Desktop All-Time Usage|Desktop All-Time Usage]]
- [[_COMMUNITY_Desktop Seven-Day Usage|Desktop Seven-Day Usage]]
- [[_COMMUNITY_Desktop Today Usage|Desktop Today Usage]]
- [[_COMMUNITY_Mobile All-Time Usage|Mobile All-Time Usage]]
- [[_COMMUNITY_Mobile Seven-Day Usage|Mobile Seven-Day Usage]]
- [[_COMMUNITY_Mobile Today Usage|Mobile Today Usage]]

## God Nodes (most connected - your core abstractions)
1. `parseAntigravityTranscript()` - 19 edges
2. `ImportResult` - 18 edges
3. `compilerOptions` - 17 edges
4. `NormalizedTurn` - 16 edges
5. `TrackerStore` - 15 edges
6. `parseOpenCodeExport()` - 13 edges
7. `SourceAdapter` - 13 edges
8. `compilerOptions` - 13 edges
9. `parseCodexSession()` - 12 edges
10. `DashboardWebviewProvider` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Partial Lower-Bound Token Quality` --semantically_similar_to--> `Metric Quality Classification`  [INFERRED] [semantically similar]
  CHANGELOG.md → README.md
- `Codex OpenCode and Antigravity Session Imports` --semantically_similar_to--> `Local Usage Sources`  [INFERRED] [semantically similar]
  CHANGELOG.md → README.md
- `Dashboard Overview Trend Turn Detail and Import Health` --semantically_similar_to--> `Dashboard Information Architecture`  [INFERRED] [semantically similar]
  CHANGELOG.md → docs/design/fidelity-ledger.md
- `Battery-Conserving Background Imports` --semantically_similar_to--> `Manual Refresh by Default`  [INFERRED] [semantically similar]
  CHANGELOG.md → README.md
- `Non-Recursive Source Scanning` --semantically_similar_to--> `Optional Background Refresh Configuration`  [INFERRED] [semantically similar]
  CHANGELOG.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Local Usage Import Pipeline** — changelog_local_session_imports, readme_local_usage_sources, readme_token_usage_tracker [INFERRED 0.95]
- **Antigravity Usage Fidelity Model** — changelog_partial_lower_bound_token_quality, changelog_antigravity_visible_context_estimation, changelog_antigravity_prompt_cleaning, readme_metric_quality_classification, readme_antigravity_lower_bound [INFERRED 0.85]
- **Dashboard Fidelity Surface** — changelog_dashboard_views, docs_design_fidelity_ledger_dashboard_information_architecture, docs_design_fidelity_ledger_filterable_turn_table, docs_design_fidelity_ledger_selected_turn_detail_panel, docs_design_fidelity_ledger_responsive_webview_layout, webview_index_webview_html_shell [INFERRED 0.75]
- **Token Usage Summary Time Windows** — docs_design_token_usage_dashboard_concept_today_usage, docs_design_token_usage_dashboard_concept_last_7_days_usage, docs_design_token_usage_dashboard_concept_all_time_usage [EXTRACTED 1.00]
- **Selected Turn Inspection** — docs_design_token_usage_dashboard_concept_selected_turn_detail, docs_design_token_usage_dashboard_concept_prompt_and_response_preview, docs_design_token_usage_dashboard_concept_token_breakdown, docs_design_token_usage_dashboard_concept_session_metadata [EXTRACTED 1.00]
- **Dashboard Source Observability** — docs_design_token_usage_dashboard_implementation_codex_cli, docs_design_token_usage_dashboard_implementation_opencode_cli, docs_design_token_usage_dashboard_implementation_antigravity_ide, docs_design_token_usage_dashboard_implementation_daily_usage_chart, docs_design_token_usage_dashboard_implementation_import_health [EXTRACTED 1.00]
- **Mobile Usage Summary Time Windows** — docs_design_token_usage_dashboard_mobile_today_usage, docs_design_token_usage_dashboard_mobile_last_7_days_usage, docs_design_token_usage_dashboard_mobile_all_time_usage [EXTRACTED 1.00]
- **Mobile Usage Quality Accounting** — docs_design_token_usage_dashboard_mobile_exact_usage, docs_design_token_usage_dashboard_mobile_estimated_usage, docs_design_token_usage_dashboard_mobile_partial_lower_bound_usage, docs_design_token_usage_dashboard_mobile_minimum_total_usage [EXTRACTED 1.00]
- **Mobile Selected Turn Inspection** — docs_design_token_usage_dashboard_mobile_selected_turn_detail, docs_design_token_usage_dashboard_mobile_prompt_and_response_preview, docs_design_token_usage_dashboard_mobile_token_breakdown, docs_design_token_usage_dashboard_mobile_session_details [EXTRACTED 1.00]
- **Stylized Character Portrait Composition** — media_icon_character_portrait, media_icon_golden_eyes, media_icon_high_bun_hairstyle, media_icon_purple_black_outfit, media_icon_pastel_abstract_background [EXTRACTED 1.00]

## Communities (45 total, 8 thin omitted)

### Community 0 - "Extension Import Pipeline"
Cohesion: 0.08
Nodes (33): paths, LocalAntigravityBridge, AntigravityAdapter, AntigravityLegacyBridge, parseLegacyAntigravitySteps(), sessionIdFromTranscript(), CodexAdapter, walkFiles() (+25 more)

### Community 1 - "Product Documentation Rationale"
Cohesion: 0.05
Nodes (50): Antigravity Prompt Cleaning, Antigravity Visible Context Estimation, Battery-Conserving Background Imports, Change Log, Dashboard Overview Trend Turn Detail and Import Health, Codex OpenCode and Antigravity Session Imports, Local Storage Safe Deletion and Diagnostics, Non-Recursive Source Scanning (+42 more)

### Community 2 - "Source Transcript Parsers"
Cohesion: 0.12
Nodes (35): asObject(), cleanUserPrompt(), estimateValue(), extractModelSelection(), extractTaggedContent(), JsonObject, parseAntigravityTranscript(), PendingTurn (+27 more)

### Community 3 - "Dashboard Data Store"
Cohesion: 0.11
Nodes (20): MeasurementQuality, Source, TokenKind, addDays(), buildDashboardSnapshot(), dateKey(), startOfDay(), summarize() (+12 more)

### Community 4 - "Webview Messaging Bridge"
Cohesion: 0.15
Nodes (10): DashboardSnapshot, ExtensionMessage, WebviewMessage, renderWebviewHtml(), WebviewHtmlOptions, DashboardWebviewProvider, WebviewAction, AppProps (+2 more)

### Community 5 - "React Dashboard UI"
Cohesion: 0.12
Nodes (14): metric(), App(), compactNumberFormatter, formatMetric(), METRIC_LABELS, metricFor(), numberFormatter, projectName() (+6 more)

### Community 6 - "Webview TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+10 more)

### Community 7 - "Mobile Dashboard Design"
Cohesion: 0.18
Nodes (18): Daily Usage Stacked Bar Chart, Estimated Token Usage, Exact Token Usage, Import Health, Legacy Session Import, Minimum Total Token Usage, Mobile Token Usage Dashboard Mockup, Partial Usage Lower Bound (+10 more)

### Community 8 - "Development Dependencies"
Cohesion: 0.12
Nodes (17): devDependencies, esbuild, jsdom, playwright, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react (+9 more)

### Community 9 - "Extension TypeScript Config"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit, resolveJsonModule (+6 more)

### Community 10 - "Dashboard Implementation Visual"
Cohesion: 0.20
Nodes (14): Antigravity IDE, Codex CLI, Daily Usage Stacked Chart, Token Usage Dashboard Implementation, Import Health, Legacy Session Import, OpenCode CLI, Session Details (+6 more)

### Community 11 - "VS Code Extension Manifest"
Cohesion: 0.14
Nodes (13): activationEvents, categories, description, displayName, engines, vscode, icon, keywords (+5 more)

### Community 12 - "Desktop Dashboard Concept"
Cohesion: 0.24
Nodes (13): Daily Usage Stacked Bar Chart, Token Usage Dashboard Mockup, Exact and Estimated Token Usage, Import Health, Legacy Session Import, Prompt and Response Preview, Selected Turn Detail Panel, Session Metadata (+5 more)

### Community 13 - "Visual QA Automation"
Cohesion: 0.15
Nodes (12): address, mimeTypes, mobileScreenshotPath, models, prompts, root, screenshotPath, server (+4 more)

### Community 14 - "Build and Test Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, package, render:icon, test, test:coverage, test:watch, typecheck (+2 more)

### Community 15 - "Raster Avatar Icon"
Cohesion: 0.29
Nodes (8): Black and Purple Jacket, Black Ponytail Hairstyle, Stylized Humanoid Avatar, Luminous Yellow Eyes, Pastel Gradient Background, Segmented Gold Halo, Stylized Avatar Icon, Three-Dimensional Anime Style

### Community 16 - "Activity Bar Contributions"
Cohesion: 0.25
Nodes (8): contributes, commands, menus, views, viewsContainers, view/title, tokenUsage, activitybar

### Community 17 - "Antigravity Legacy Bridge"
Cohesion: 0.39
Nodes (5): callApi(), discoverEndpoints(), Endpoint, execFileAsync, parseLanguageServerProcessList()

### Community 18 - "Vector Character Icon"
Cohesion: 0.29
Nodes (7): Stylized Character SVG Icon, Stylized Character Portrait, Golden Eyes, Dark High-Bun Hairstyle, Mosaic-Like Vector Illustration Style, Pastel Abstract Background, Purple and Black Outfit

### Community 19 - "Storage Configuration"
Cohesion: 0.29
Nodes (7): properties, title, configuration, tokenUsage.storagePath, default, description, type

### Community 20 - "Runtime Dependencies"
Cohesion: 0.33
Nodes (6): dependencies, js-tiktoken, lucide-react, react, react-dom, sql.js

### Community 21 - "Refresh Interval Settings"
Cohesion: 0.33
Nodes (6): tokenUsage.refreshIntervalMinutes, default, description, maximum, minimum, type

### Community 22 - "Background Refresh Scheduler"
Cohesion: 0.40
Nodes (3): RefreshScheduler, RefreshSchedulerOptions, startRefreshScheduler()

### Community 23 - "Prompt Retention Settings"
Cohesion: 0.40
Nodes (5): tokenUsage.promptRetention, default, description, enum, type

### Community 24 - "Background Refresh Toggle"
Cohesion: 0.50
Nodes (4): tokenUsage.backgroundRefresh.enabled, default, description, type

### Community 25 - "Antigravity Path Setting"
Cohesion: 0.50
Nodes (4): tokenUsage.paths.antigravity, default, description, type

### Community 26 - "Codex Path Setting"
Cohesion: 0.50
Nodes (4): tokenUsage.paths.codex, default, description, type

### Community 27 - "OpenCode Path Setting"
Cohesion: 0.50
Nodes (4): tokenUsage.paths.opencode, default, description, type

### Community 28 - "Antigravity Source Toggle"
Cohesion: 0.50
Nodes (4): tokenUsage.sources.antigravity.enabled, default, description, type

### Community 29 - "Codex Source Toggle"
Cohesion: 0.50
Nodes (4): tokenUsage.sources.codex.enabled, default, description, type

### Community 30 - "OpenCode Source Toggle"
Cohesion: 0.50
Nodes (4): tokenUsage.sources.opencode.enabled, default, description, type

### Community 31 - "Icon Rendering Script"
Cohesion: 0.50
Nodes (3): root, source, target

### Community 32 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

## Ambiguous Edges - Review These
- `Dashboard Information Architecture` → `Token Usage Webview HTML Shell`  [AMBIGUOUS]
  webview/index.html · relation: implements

## Knowledge Gaps
- **189 isolated node(s):** `name`, `displayName`, `description`, `version`, `publisher` (+184 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Dashboard Information Architecture` and `Token Usage Webview HTML Shell`?**
  _Edge tagged AMBIGUOUS (relation: implements) - confidence is low._
- **Why does `properties` connect `Storage Configuration` to `Refresh Interval Settings`, `Prompt Retention Settings`, `Background Refresh Toggle`, `Antigravity Path Setting`, `Codex Path Setting`, `OpenCode Path Setting`, `Antigravity Source Toggle`, `Codex Source Toggle`, `OpenCode Source Toggle`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `contributes` connect `Activity Bar Contributions` to `Storage Configuration`, `VS Code Extension Manifest`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `configuration` connect `Storage Configuration` to `Activity Bar Contributions`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `parseAntigravityTranscript()` (e.g. with `asObject()` and `turn()`) actually correct?**
  _`parseAntigravityTranscript()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `displayName`, `description` to the rest of the system?**
  _196 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Extension Import Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.08035714285714286 - nodes in this community are weakly interconnected._