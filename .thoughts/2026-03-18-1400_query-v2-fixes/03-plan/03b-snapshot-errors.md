---
title: "Phase 3B: Snapshot Hydration Error Handling"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Make `hydrateSnapshot` throw descriptive errors on version/prefix mismatch instead of silently returning, and log `console.warn` for unknown resource keys instead of silently skipping. Update existing tests to expect the new behavior. [ref: ../02-design/04-decisions.md ADR-4]

## Dependencies

- **Requires**: Phase 2 (Standalone Hooks) — no direct file dependency, but ordering ensures files are at final paths before modifying
- **Blocks**: Phase 4A (JSDoc — adds inline comment at error logic), Phase 4B (Docs — describes new error behavior)

## Execution

Parallel with Phase 3A (DevTools Isolation).

## Tasks

### Task 3B.1: Update `hydrateSnapshot` error handling in `Snapshot.ts`

- **File**: `src/query-v2/snapshot/Snapshot.ts`
- **Action**: Modify
- **Description**: Modify the `hydrateSnapshot` function (lines ~57–96) with three changes:
  1. **Version mismatch** (currently line ~68–70: `if (snapshot.version !== CURRENT_SNAPSHOT_VERSION) return;`):
     Replace `return;` with:
     ```typescript
     throw new Error(
         `Snapshot version mismatch: expected ${CURRENT_SNAPSHOT_VERSION}, got ${snapshot.version}. ` +
         `The snapshot format is incompatible with the current version of query-v2.`
     );
     ```
  2. **Key prefix mismatch** (currently line ~73–75: `if (snapshot.keyPrefix !== apiKeyPrefix) return;`):
     Replace `return;` with:
     ```typescript
     throw new Error(
         `Snapshot keyPrefix mismatch: expected "${apiKeyPrefix}", got "${snapshot.keyPrefix}". ` +
         `Ensure the snapshot was created by the same API instance configuration.`
     );
     ```
  3. **Unknown resource key** (currently line ~80: `if (!resource) continue;`):
     Replace `continue;` with:
     ```typescript
     console.warn(`[rx-toolkit] hydrateSnapshot: unknown resource key "${resourceKey}", skipping.`);
     continue;
     ```
  - `Machine.fromSnapshot` error behavior is unchanged — it already throws on corrupt status.
  - `resource.hydrateEntry` existing-entry no-op behavior is unchanged.
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-4 §decision], [ref: ../02-design/02-dataflow.md §3-snapshot-hydration], [ref: ../02-design/05-usecases.md §4-snapshot-errors UC-4.1 through UC-4.6]
- **Complexity**: Low

### Task 3B.2: Update snapshot unit tests (S4, S5) and add new test cases

- **File**: `src/query-v2/snapshot/__tests__/Snapshot.test.ts`
- **Action**: Modify
- **Description**: Update existing tests and add new ones:
  1. **Update S4** (version mismatch test): Change from asserting "entries are not hydrated" (silent skip) to `expect(() => hydrateSnapshot(...)).toThrow(/version mismatch/)`. Verify error message contains both expected and actual version numbers. (T29)
  2. **Update S5** (key prefix mismatch test): Change from asserting "silently skipped" to `expect(() => hydrateSnapshot(...)).toThrow(/keyPrefix mismatch/)`. Verify error message contains both expected and actual prefixes. (T30)
  3. **Add T31**: Unknown resource key logs warning and continues — spy on `console.warn`, call `hydrateSnapshot` with snapshot containing unknown resource key, verify `console.warn` called with message containing the unknown key, verify known resources are still hydrated.
  4. **Add T32**: Multiple entries with one valid + one unknown resource — verify partial hydration success and warning for unknown.
  5. **Add T33** (optional P1): Corrupt machine status — verify `Machine.fromSnapshot` throw propagates (existing behavior, but now explicitly tested).
  6. **Verify S1–S3, S6–S8 still pass** without changes (T34–T36 regression).
- **Design reference**: [ref: ../02-design/06-testcases.md §fix-5], addresses T29–T36
- **Complexity**: Medium

### Task 3B.3: Update SSR hydration integration tests

- **File**: `src/query-v2/__tests__/integration/ssr-hydration.test.ts`
- **Action**: Modify
- **Description**: Two integration tests change behavior:
  1. **Version mismatch test**: Currently verifies "snapshot ignored" (no entries hydrated). Change to `expect(() => ...).toThrow(/version mismatch/)`. The test should verify the error propagates from `hydrateSnapshot` through `createResource` to the caller. (T37)
  2. **Key prefix mismatch test**: Same pattern — change from "no hydration" to `expect(() => ...).toThrow(/keyPrefix mismatch/)`. (part of T37)
  3. **Verify valid snapshot round-trip** still works (T38 — existing test, no change needed).
  - Error messages must include both expected and actual values for easy diagnosis [ref: ../02-design/08-risks.md R1 mitigation step 3].
- **Design reference**: [ref: ../02-design/06-testcases.md §fix-5 T37–T38], [ref: ../02-design/08-risks.md R1, R5]
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes
- [ ] `vitest run src/query-v2/snapshot/` — S4 and S5 expect `toThrow`, S1–S3/S6–S8 unchanged (T29, T30, T34–T36)
- [ ] `vitest run src/query-v2/snapshot/` — new T31/T32 tests pass (`console.warn` verified)
- [ ] `vitest run src/query-v2/__tests__/integration/ssr-hydration.test.ts` — version/prefix mismatch tests expect throws (T37), valid SSR round-trip passes (T38)
- [ ] Error messages are descriptive: contain expected value, actual value, and actionable guidance [mitigates R1, R5]
- [ ] `Machine.fromSnapshot` corrupt status throw behavior is unchanged (T33)
- [ ] `vitest run src/query-v2/` — full regression suite green
