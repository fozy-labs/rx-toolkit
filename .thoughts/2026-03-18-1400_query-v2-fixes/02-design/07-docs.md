---
title: "Documentation Impact — Query v2 Fixes"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Documentation Impact

## Fix #7: Optimistic Update Snapshot Behavior

**File**: `docs/query-v2/ssr.md` — section "Ограничения"

Add to existing limitations list:
- `data` in snapshot during active patches is the patched (optimistic) value, not `originalData`
- `originalData` and `patches` are excluded from `TResourceV2SnapshotSlice`
- Hydrating a mid-patch snapshot installs optimistic data as canonical
- Recommendation: commit/abort patches before `getSnapshot()`

Scope: 3–5 bullet points appended to the existing "Ограничения" list. No new sections.

## Fix #1 + #2: Standalone Hooks

**File**: `docs/query-v2/api-reference.md` — section "ReactHooksPlugin"

Add a note that `useResourceV2Agent` and `useResourceV2Ref` are also available as standalone imports from `@fozy-labs/rx-toolkit/query-v2/react`, without requiring `ReactHooksPlugin`.

**File**: `docs/query-v2/README.md` — section "Agents (Агенты)" or usage examples

One sentence + short code snippet showing the standalone import path alongside the existing plugin-based example.

Scope: ~5 lines per file.

## Fix #5: Snapshot Hydration Errors

**File**: `docs/query-v2/ssr.md` — section "Ограничения" or new sub-section "Ошибки гидрации"

Note that `hydrateSnapshot` now throws on version/prefix mismatch (previously silent skip). Mention `console.warn` for unknown resource keys. Advise try/catch for rolling-deployment scenarios.

Scope: 3–4 bullet points.
