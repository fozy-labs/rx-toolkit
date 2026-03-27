---
title: "Verification: Phase 9"
date: 2026-03-26
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| `npm run ts-check` (root) | PASS | 0 non-legacy errors. 114 errors all in `src/query-v2-legacy/` (pre-existing). |
| Demo app TS compilation (`apps/demos`) | FAIL | 5 errors in query-v2 demo files (see below). |
| v0.2 docs exist (`docs/query-v2/v0.2/`) | PASS | All 3 files present: `README.md`, `optimistic-updates.md`, `ssr.md`. |
| v0.1 deprecation banners | PASS | All 4 v0.1 docs (`README.md`, `optimistic-updates.md`, `ssr.md`, `Внутриянка.md`) have `⚠️ **Deprecated**` banners linking to v0.2 equivalents. |
| `docs/query-v2/README.md` links to both versions | PASS | Links to `./v0.2/README.md` (актуальная версия) and `./v0.1/README.md` (deprecated). |
| Migration guide v0.1→v0.2 | PASS | `docs/migrations/query-v2.md` contains "Миграция v0.1 → v0.2" section with API mapping table and code examples. |
| Demo files use v0.2 API imports | PASS | All 3 demos (`simple-resource.tsx`, `optimistic-patches.tsx`, `ssr-snapshot.tsx`) import from `unstable_queryV2`. |
| `npm run check:all` | N/A | Script does not exist in `package.json`. |

## Demo App Errors (5 total)

```
src/examples/query-v2/optimistic-patches.tsx(130,37): error TS7006: Parameter 'item' implicitly has an 'any' type.
src/examples/query-v2/simple-resource.tsx(38,52): error TS7006: Parameter 'item' implicitly has an 'any' type.
src/examples/query-v2/ssr-snapshot.tsx(16,7): error TS2741: Property 'timestamp' is missing in type '{ version: any; keyPrefix: string; resources: { users: { entries: { ... }; }; }; }' but required in type 'TApiSnapshot'.
src/examples/query-v2/ssr-snapshot.tsx(56,21): error TS7006: Parameter 'args' implicitly has an 'any' type.
src/examples/query-v2/ssr-snapshot.tsx(56,42): error TS7031: Binding element '_abortSignal' implicitly has an 'any' type.
```

- 3 errors are `TS7006`/`TS7031` (implicit `any`) — missing type annotations on callback parameters.
- 1 error is `TS2741` — `timestamp` property missing from the mock snapshot object in `ssr-snapshot.tsx`.

Note: The demos project has its own `tsconfig.json` and is NOT covered by the root `npm run ts-check`. Root ts-check passes cleanly (excluding pre-existing legacy errors).

## Summary

7/8 checks passed. 1 failure: demo app TypeScript compilation has 5 errors in query-v2 demo files (implicit `any` types + missing `timestamp` property in snapshot mock).
