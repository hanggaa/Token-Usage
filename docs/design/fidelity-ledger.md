# Dashboard fidelity ledger

- **Information architecture:** The implementation preserves the accepted concept's three summary cards, trend and import-health row, filterable turn table, and selected-turn detail panel.
- **Typography and density:** Both use compact IDE-native typography with monospace data. The implementation is slightly denser so it remains useful inside a narrow VS Code webview.
- **Palette and source identity:** The charcoal surface and cyan, violet, amber, and green accents match the concept and remain compatible with VS Code theme variables.
- **Turn table:** The desktop capture shows seven rows, source/model/project filters, a highlighted selection, numeric token columns, and an em dash for unavailable values.
- **Turn details:** Prompt, response preview, token breakdown, and session metadata are present. The close control is functional, and selecting any row reopens the panel.
- **Responsive behavior:** At 390×844, summary cards, analytics panels, and details stack vertically; filters wrap and the dense table remains horizontally scrollable.
- **Copy comparison:** Above-the-fold labels from the concept are retained: “Token Usage,” “Today,” “Last 7 Days,” “All Time,” “Usage Over Time,” “Import Health,” and “Search prompts.” Dates, models, projects, and token figures are intentionally data-driven.
- **Material fixes from visual review:** Added the legacy-source health state, compact chart-axis labels, aligned table pagination, explicit unavailable quality, and the detail-panel close control.
- **Intentional deviations:** Runtime content differs from concept sample data, and macOS native rendering could not be exercised in the Windows development environment.
