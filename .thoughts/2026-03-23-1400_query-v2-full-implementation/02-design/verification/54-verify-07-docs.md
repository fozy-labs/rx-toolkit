# Verification #54 — 07-docs.md against all raised issues

**File**: `02-design/07-docs.md`
**Issues checked**: #1, #2, #4, #5, #17, #22, #27, #31, #49

## Results

| Issue | Summary | Verdict | Evidence |
|-------|---------|---------|----------|
| #1 | V2 suffix in doc references | PASS | `createResourceV2`, `useResourceV2Agent`, `IResourceV2CacheEntry` all carry V2 suffix. `createApi` correctly omits V2 per ADR-15. No bare `Resource` for v0.2 concepts. |
| #2 | Commands removed from documentation impact | PASS | Zero mentions of "Command", "createCommand" in the document. |
| #4 | useOperationV2 / useResourceV2 removed from docs | PASS | No `useOperationV2` anywhere. `useResourceV2Ref` appears only in Migration Guide Scope (line 40), correctly describing the v0.1→v0.2 breaking change ("consolidation into `IResourceV2CacheEntry.createPatch`"). `useResourceV2Ref` is a legitimate v0.1 export (confirmed in `src/query-v2-legacy/react/index.ts`). New v0.2 design uses only `useResourceV2Agent`. |
| #5 | Design differentiated from legacy in doc structure | PASS | New docs go to `docs/query-v2/v0.2/`. Existing `docs/query-v2/v0.1/` files get deprecation banners. Migration section references v0.1→v0.2 explicitly. |
| #17 | Operations/OperationV2 removed from doc plan | PASS | Zero mentions of "Operation", "OperationV2", "createOperation" in the document. |
| #22 | No SharedOptions/DefaultOptions in docs | PASS | Zero mentions of "SharedOptions" or "DefaultOptions". |
| #27 | No resetAllCacheV2 in docs | PASS | Only `resetAll()` is referenced (line 35: "`getEntry$` reactivity to `resetAll()` via `_status$`/`_lastEntry$` signals") — this is the `api.resetAll()` method, not a standalone function. Zero mentions of `resetAllCacheV2` or `resetAllQueriesCache`. |
| #31 | refreshError removed from docs | PASS | Zero mentions of "refreshError", "onRefreshError", "notifyRefreshError". |
| #49 | Snapshot documentation reflects correct lifecycle | PASS | SSR section (line 25) lists "Snapshot capture/hydrate, `maxSnapshotDataAge`, `compare` strategy limitation" — consistent with ADR-12's save→consume+delete→delete lifecycle. No "already exists", "conditional hydration", "skip hydration", or "selective hydration" language present (confirmed via grep). |

## Additional Observations

- **Proportionality**: Doc plans 3 new files in `v0.2/` (README, optimistic-updates, ssr), deprecation banners on 4 existing v0.1 files, and a migration section in the existing `docs/migrations/query-v2.md`. Existing v0.1 has 4 files (README, optimistic-updates, ssr, Внутриянка). The v0.2 additions are proportional and mirror v0.1 structure.
- **Demo updates**: All 3 referenced demos (`simple-resource.tsx`, `optimistic-patches.tsx`, `ssr-snapshot.tsx`) exist in `apps/demos/src/examples/query-v2/`. No new demo files planned — updates only. Proportional.
- **WHAT not HOW**: The document describes what documentation needs to exist and what topics to cover, without providing full drafts, JSDoc proposals, or implementation-level prose.

## Verdict

**ALL 9 ISSUES PASS**. No regressions found.
