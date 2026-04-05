## docs/query/README.md
No semantic changes identifiable — clean Russian landing page matching the plan (intro, quick start, features, nav table). `typeof SKIP` phrasing absent.

## docs/query/concepts/architecture.md
- SKIP phrasing fixed: `специальное значение SKIP` (not `typeof SKIP`) in Agent description and glossary
- Glossary entry for Machine uses `refreshing` (not `refresh-error`) in transition chain
- No sequence diagrams (moved to future agent.md per plan)
- Otherwise matches expected structure (component diagram, layers, glossary)

## docs/query/concepts/machine.md
- **NOT updated to 4 states.** Despite Set-Content writing a 4-state version (visible in terminal), the file on disk still has the 5-state model:
  - `refresh-error` remains a full machine state with its own `TRefreshErrorState` interface
  - `TSuccessState` does NOT have `lastError` field
  - Diagram shows `refreshing → refresh_error` transition (contradicts code: only 4 machine classes)
  - Uses `finishAllPatches()` instead of correct `abortAllPendingPatches()`
  - `success → refreshing` labeled `refresh()` instead of `invalidate()`
  - Missing: `error → pending : start(newArgs)`, `success → pending : start(newArgs)`
- **Conclusion:** Set-Content was reverted or overridden by VS Code buffer. All r-machine-gaps.md fixes are still pending.

## docs/query/concepts/cache.md
- Resource-only bias fixed: "Каждый ресурс или команда владеет собственной картой кеша"
- Cache key section split: resources use `serializeArgs`, commands use explicit `key`
- `cacheRetentionTime` table: generic `number`/`false` — does NOT show differing defaults (60s resources, 0 commands)
- Link to `[api-cmd]` added
- Cross-references to machine, agent, patching, lifecycle, snapshot — all present
