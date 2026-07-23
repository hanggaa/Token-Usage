# AGENTS.md Contributor Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a concise, repository-specific `AGENTS.md` contributor guide without overwriting any file that may appear before implementation.

**Architecture:** This is a documentation-only change. A single root-level `AGENTS.md` will provide operational guidance for human contributors and coding agents, while `README.md` remains the public product and installation guide.

**Tech Stack:** GitHub-flavored Markdown, Node.js/npm, TypeScript, React, Vitest, Testing Library, VS Code extension tooling.

## Global Constraints

- Before creating `AGENTS.md`, check the repository root again; if it exists, stop without modifying or replacing it.
- Use the exact title `# Repository Guidelines`.
- Keep the final guide between 200 and 400 words.
- Use concise, repository-specific, professional, and instructional wording.
- Do not modify source code, tests, configuration, package scripts, `README.md`, or `CHANGELOG.md`.
- Do not invent linting, formatting, coverage thresholds, or pull-request automation.
- Preserve the local-only privacy model, read-only source access, authentication-file boundary, and measurement-quality distinctions.
- Stage and commit only `AGENTS.md`; preserve every unrelated working-tree change.

---

## File Structure

- Create `AGENTS.md`: root-level contributor and agent instructions.
- Reference `package.json`: authoritative npm scripts and toolchain; do not modify it.
- Reference `README.md`: authoritative privacy and project-layout descriptions; do not modify it.
- Reference `vitest.config.ts`, `tsconfig.json`, and `webview/tsconfig.json`: authoritative test and TypeScript configuration; do not modify them.
- Reference `docs/superpowers/specs/2026-07-23-agents-contributor-guide-design.md`: approved requirements; do not modify it.

### Task 1: Create and verify the repository contributor guide

**Files:**
- Create: `AGENTS.md`
- Reference: `package.json`
- Reference: `README.md`
- Reference: `vitest.config.ts`
- Reference: `tsconfig.json`
- Reference: `webview/tsconfig.json`
- Reference: `docs/superpowers/specs/2026-07-23-agents-contributor-guide-design.md`

**Interfaces:**
- Consumes: current directory structure, npm script names, TypeScript conventions, Vitest patterns, Git history, and privacy requirements.
- Produces: a 200–400-word root-level contributor guide titled `Repository Guidelines`.

- [ ] **Step 1: Enforce the overwrite guard**

Run:

```bash
if test -e AGENTS.md; then echo 'STOP: AGENTS.md already exists'; exit 1; else echo 'AGENTS.md is absent; creation is allowed'; fi
```

Expected: `AGENTS.md is absent; creation is allowed`. If the command exits 1, stop the task and do not touch the file.

- [ ] **Step 2: Create `AGENTS.md` with the approved content**

Use `apply_patch` to create this exact document:

````markdown
# Repository Guidelines

## Project Structure & Module Organization

Extension-host and domain code lives in `src/`: adapters discover and parse Codex, OpenCode, and Antigravity histories; services coordinate imports and calculate dashboard data; storage manages the local SQLite index; shared modules define host/webview contracts; and `src/webview/` connects VS Code to the UI. React components and styles live in `webview/src/`. Backend tests mirror source areas under `tests/`; component tests are colocated in `webview/src/`. Build helpers are in `scripts/`, icons in `media/`, and design or planning records in `docs/`.

## Build, Test, and Development Commands

- `npm install` installs pinned dependencies.
- `npm run watch` rebuilds the extension and webview while files change.
- `npm run test` runs the Vitest suite once; `npm run test:watch` supports iteration.
- `npm run typecheck` checks both TypeScript projects without emitting files.
- `npm run verify` runs tests, both typechecks, and the production build. Use it before submission.
- `npm run package` creates the versioned VSIX in the repository root.
- `node scripts/visual-qa.mjs` performs Playwright visual checks after dashboard changes.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, semicolons, and double quotes. Name functions and variables in `camelCase`; types and React components in `PascalCase`; service modules in kebab-case. Use `.test.ts` or `.test.tsx` for tests. No dedicated formatter or linter is configured, so match surrounding code and let typechecks and tests enforce correctness.

## Testing Guidelines

Vitest covers extension and service code; React Testing Library with JSDOM covers webview behavior. Write behavior-focused `describe`/`it` names and place tests beside comparable coverage. During iteration, run a focused file, for example `npm run test -- tests/services/calendar-periods.test.ts`. Run `npm run verify` before opening a PR. Use `npm run test:coverage` for reports; no minimum threshold is configured.

## Commit & Pull Request Guidelines

Follow the repository's lowercase conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, or `refactor:`. Keep each commit focused. PRs should explain the user-visible effect, link an issue when applicable, list verification commands and results, and include screenshots for dashboard or visual changes.

## Security & Agent Instructions

Preserve local-only processing: source histories remain read-only, authentication files are never accessed, and exact, estimated, partial lower-bound, and unavailable metrics remain distinct. Check `git status` before editing, preserve unrelated user changes, and stage only task files. Do not commit generated or local artifacts such as `node_modules/`, `dist/`, `coverage/`, `*.vsix`, `.superpowers/`, `graphify-out/`, or `.DS_Store`.
````

- [ ] **Step 3: Validate length, headings, commands, and key safeguards**

Run:

```bash
words=$(wc -w < AGENTS.md | tr -d ' ')
test "$words" -ge 200
test "$words" -le 400
echo "AGENTS.md word count: $words"
rg -n '^# Repository Guidelines$|^## (Project Structure & Module Organization|Build, Test, and Development Commands|Coding Style & Naming Conventions|Testing Guidelines|Commit & Pull Request Guidelines|Security & Agent Instructions)$' AGENTS.md
rg -n 'npm run (watch|test|typecheck|verify|package|test:coverage)|scripts/visual-qa\.mjs|Vitest|React Testing Library|local-only|read-only|git status' AGENTS.md
```

Expected: word count is within 200–400; the title, all six sections, required commands, test tools, privacy safeguards, and working-tree safeguard are present.

- [ ] **Step 4: Validate scope and Markdown hygiene**

Run:

```bash
git diff --check -- AGENTS.md
git status --short
```

Expected: `git diff --check` exits 0. `git status --short` shows `?? AGENTS.md` plus any pre-existing unrelated state; no existing tracked file is modified by this task.

- [ ] **Step 5: Review and commit only the contributor guide**

Run:

```bash
git diff --no-index /dev/null AGENTS.md
git add AGENTS.md
git diff --cached --name-only
git commit -m "docs: add repository contributor guide"
```

Expected: the staged-file list contains only `AGENTS.md`; the local commit succeeds with the planned message.
