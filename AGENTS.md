# Repository Guidelines

## Project Structure & Module Organization

Extension-host and domain code lives in `src/`: adapters parse local histories; services coordinate imports and dashboard data; storage manages the SQLite index; shared modules define host/webview contracts; and `src/webview/` connects VS Code to the UI. React components/styles live in `webview/src/`. Backend tests mirror `src/` under `tests/`; component tests are colocated in `webview/src/`. Build helpers, icons, and project records are in `scripts/`, `media/`, and `docs/`.

## Build, Test, and Development Commands

- `npm install` installs pinned dependencies.
- `npm run watch` does a one-time extension/webview build; rerun after changes.
- `npm run test` runs the Vitest suite once; `npm run test:watch` supports iteration.
- `npm run typecheck` checks both TypeScript projects without emitting files.
- `npm run verify` runs tests, both typechecks, and the production build. Use it before submission.
- `npm run package` creates the versioned VSIX in the repository root.
- `node scripts/visual-qa.mjs` performs Playwright visual checks after dashboard changes; run `npm run build` or `npm run verify` immediately beforehand so it checks current output.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, semicolons, and double quotes. Name functions and variables in `camelCase`; types and React components in `PascalCase`; service modules in kebab-case. Use `.test.ts` or `.test.tsx` for tests. No formatter or linter is configured; match surrounding code and use typechecks and tests.

## Testing Guidelines

Vitest covers extension and service code; React Testing Library with JSDOM covers webview behavior. Write behavior-focused `describe`/`it` names; colocate comparable tests. During iteration, use a focused file, e.g. `npm run test -- tests/services/calendar-periods.test.ts`. Run `npm run verify` before opening a PR. Use `npm run test:coverage` for reports; no minimum threshold is configured.

## Commit & Pull Request Guidelines

Follow the repository's lowercase conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, or `refactor:`. Keep each commit focused. PRs should explain user-visible effect, link issues when applicable, list verification commands/results, and include screenshots for dashboard or visual changes.

## Security & Agent Instructions

Preserve local-only processing: source histories remain read-only, authentication files are never accessed, and exact, estimated, partial lower-bound, and unavailable metrics remain distinct. Check `git status` before editing, preserve unrelated user changes, and stage only task files. Do not add generated artifacts unless explicitly required. Treat tracked `graphify-out/` files as task-scoped artifacts, and never modify `.DS_Store` unless specifically requested. Keep untracked `node_modules/`, `dist/`, `coverage/`, `*.vsix`, and `.superpowers/` out of commits.
