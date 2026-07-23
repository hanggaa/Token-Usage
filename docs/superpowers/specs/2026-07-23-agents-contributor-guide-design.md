# AGENTS.md Contributor Guide Design

## Goal

Create a concise, repository-specific `AGENTS.md` titled **Repository Guidelines**. It should help human contributors and coding agents make safe, verifiable changes without duplicating the public README.

## Overwrite Guard

Before creating `AGENTS.md`, check the repository root again. If the file exists, stop without modifying or replacing it. This guard applies even if the existing file differs from this design.

## Audience and Length

Write for contributors who have basic Node.js, TypeScript, React, and Git experience but are new to this repository. Keep the final guide between 200 and 400 words, with short paragraphs and actionable bullets.

## Document Structure

The document will use these sections:

1. **Project Structure & Module Organization** — map `src/adapters/`, `src/services/`, `src/storage/`, `src/shared/`, `src/webview/`, `webview/src/`, `tests/`, `scripts/`, `media/`, and `docs/` to their responsibilities.
2. **Build, Test, and Development Commands** — explain `npm install`, `npm run watch`, `npm run test`, `npm run typecheck`, `npm run verify`, `npm run package`, and `node scripts/visual-qa.mjs`.
3. **Coding Style & Naming Conventions** — require two-space indentation, strict TypeScript, ES modules, semicolons, double quotes, `camelCase` functions, `PascalCase` React components and types, kebab-case service files, and `.test.ts`/`.test.tsx` tests. State that no dedicated formatter or linter is configured, so contributors must match surrounding code and rely on typechecks and tests.
4. **Testing Guidelines** — identify Vitest, Testing Library, and JSDOM; direct contributors to mirror source areas under `tests/`, use behavior-focused test names, run focused tests while iterating, and run `npm run verify` before submission. Mention `npm run test:coverage` without claiming a configured coverage threshold.
5. **Commit & Pull Request Guidelines** — use the dominant lowercase conventional prefixes `feat:`, `fix:`, `test:`, `docs:`, `chore:`, and `refactor:`. Require a concise PR description, linked issue when applicable, verification evidence, and screenshots for dashboard or visual changes.
6. **Security & Agent Instructions** — preserve the local-only privacy model, keep source histories read-only, never access authentication files, maintain exact/estimated/partial lower-bound/unavailable distinctions, and protect unrelated working-tree changes. Do not add generated artifacts unless explicitly required; treat tracked `graphify-out/` files as task-scoped artifacts, and never modify `.DS_Store` unless specifically requested.

## Writing Style

- Use the exact title `# Repository Guidelines`.
- Prefer specific commands and paths over generic advice.
- Keep explanations professional, direct, and instructional.
- Avoid release notes, product marketing, and duplicated feature documentation.
- Do not invent formatting, linting, coverage, or pull-request automation that the repository does not provide.

## Validation

- Recheck that `AGENTS.md` did not appear before writing.
- Confirm the final document is 200–400 words.
- Confirm every required heading and key command is present.
- Confirm Markdown headings and code spans are well formed.
- Run `git diff --check -- AGENTS.md`.
- Inspect `git status --short` and stage only `AGENTS.md`; leave unrelated files untouched.

## Out of Scope

- Changing source code, tests, configuration, or package scripts.
- Updating `README.md` or `CHANGELOG.md`.
- Adding CI, linting, formatting, or contribution templates.
- Publishing packages or pushing commits remotely.
