---
title: "Verification: Redraft Round 1 — Medium Issues (#7, #8, #9, #10)"
date: 2026-03-26
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| ts-check (src/query-v2/) | PASS | 0 errors in `src/query-v2/` — all 115 errors are confined to `src/query-v2-legacy/` (out of scope) |
| ts-check (apps/demos/) | PASS | 0 errors in `apps/demos/src/examples/query-v2/` (issue #9 resolved) |
| GC01–GC05 (ResourceV2.test.ts) | PASS | All 27 tests in ResourceV2.test.ts passed, including GC01–GC05 (issue #7) |
| RE19–RE22 (ResourceV2.test.ts) | PASS | RE19 (Batcher.run), RE20–RE22 (status$ lifecycle) all passed (issue #8) |
| INT05–INT06 (gc-lifecycle.test.ts) | PASS | 2/2 integration GC tests passed (issue #7) |
| type-level.test.ts no crash | PASS | 2/2 type-level tests passed with no runtime crash (issue #10) |
| Full regression (src/query-v2/) | PASS (with known failure) | 246/247 tests passed. 21/22 test files passed. |
| RH09 error path | FAIL (pre-existing) | `expected 'pending' to be 'error'` — same failure as before Phase 24; not a regression |

## Summary

7/8 checks passed. 1 known pre-existing failure (RH09: error state hook test) remains — this was already failing before Phase 24 and is not a regression introduced by the medium-issue fixes.

All four targeted issues are resolved:
- **#7 (GC mechanism)**: GC01–GC05 unit tests and INT05–INT06 integration tests all pass.
- **#8 (status$ public)**: RE19–RE22 pass, confirming status$ lifecycle works correctly.
- **#9 (demo TS errors)**: Zero TypeScript errors in `src/query-v2/` and `apps/demos/`.
- **#10 (type-level.test.ts crash)**: Runs cleanly, 2/2 pass, no runtime crash.
