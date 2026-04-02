# Technical Accuracy Review

**Date:** 2026-04-02  
**Reviewed:** `.thoughts/2026-04-02-1400_query-core-extraction/report/README.md`  
**Verified against:** source code at `src/query/core/`

---

## 1. File Paths

| Report Path | Actual Path | Status |
|---|---|---|
| `@/src/query/core/CacheEntry.ts` | `src/query/core/CacheEntry.ts` | ✓ |
| `@/src/query/core/Resource/ResourceCacheEntry.ts` | `src/query/core/resource/ResourceCacheEntry.ts` | **WRONG CASE** — directory is `resource`, not `Resource` |
| `@/src/query/core/command/CommandCacheEntry.ts` | `src/query/core/command/CommandCacheEntry.ts` | ✓ |
| `@/src/query/core/machines/` | `src/query/core/machines/` | ✓ |

**Severity: Low.** Windows filesystem is case-insensitive so imports work, but the report is inconsistent — uses capital `Resource` but lowercase `command`.

---

## 2. LOC Numbers

### Total Lines (file length)

| File | Report | Actual | Status |
|---|---|---|---|
| ResourceCacheEntry.ts | 352 lines | 352 lines | ✓ |
| CommandCacheEntry.ts | 294 lines | 294 lines | ✓ |
| CacheEntry.ts | **76 lines** | **72 lines** | **WRONG** (−4) |

### LOC (non-blank lines — report's apparent methodology)

| File | Report | Actual | Status |
|---|---|---|---|
| ResourceCacheEntry.ts | 296 LOC | 296 non-blank | ✓ |
| CommandCacheEntry.ts | 249 LOC | 249 non-blank | ✓ |
| CacheEntry.ts | **74 LOC** | **61 non-blank** | **WRONG** (−13) |

**Severity: Medium.** CacheEntry numbers are wrong in both total (76 → 72) and LOC (74 → 61). The file is 72 lines with 61 non-blank, confirmed by direct reading and line counting. This error propagates to the executive summary ("CacheEntry (76 lines)") and §2 ("76 lines / 74 LOC"). The combined LOC figure (545) is unaffected since it sums only RCE + CCE.

---

## 3. Class/Method/Field Names

### CacheEntry

| Claim | Actual | Status |
|---|---|---|
| `_state$: SignalFn<TState>` | `private _state$: SignalFn<TState>` | ✓ |
| `_isCompleted: boolean` | `private _isCompleted = false` | ✓ |
| `onClean$: Subject<void>` | `readonly onClean$ = new Subject<void>()` | ✓ |
| `obs`, `state$` | Present as `readonly` | ✓ |
| `peek()`, `set()`, `complete()` | All present | ✓ |
| `Signal.state` used | `Signal.state<TState>(initialState, signalOpts)` | ✓ |
| `signalize(obs)` bridge | `this.state$ = signalize(this.obs)` | ✓ |
| `share({ resetOnRefCountZero: () => timer(lifetime) })` | Uses `_getResetOnRefCountZero()` helper; returns `() => timer(lifetime)` for positive lifetimes | ✓ (simplified in report but accurate) |

### ResourceCacheEntry

| Claim | Actual | Status |
|---|---|---|
| `machine$: ReadableSignalFnLike` | `readonly machine$: ReadableSignalFnLike<TMachineInstance<TArgs, TData>>` | ✓ |
| `_queryFn`, `_abortController` | Present | ✓ |
| `_patchState`, `_inflightPromise` | Present | ✓ |
| `_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled` | All three `PromiseResolver` fields present | ✓ |
| `query(doForce?)` | `query(doForce?: boolean): Promise<TData>` | ✓ |
| `invalidate()` | Present | ✓ |
| `createPatch(patchFn)` | `createPatch(patchFn: (draft: TData) => void): IPatchHandle \| null` | ✓ |

### CommandCacheEntry

| Claim | Actual | Status |
|---|---|---|
| `_queryFn`, `_abortController`, `_link` | Present | ✓ |
| `_triggerResolver` | Present | ✓ |
| `_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled` | All three present | ✓ |
| `initiate(args)` | `initiate(args: TArgs): Promise<TResult>` | ✓ |
| `resetToIdle()` | Present | ✓ |

### Asymmetries Table — Minor Name Issues

| Report Claim | Actual | Status |
|---|---|---|
| Resource has `_beforeDevtoolsPush` hook | No such field on ResourceCacheEntry; `beforeDevtoolsPush` is an option passed via `ICacheEntryOptions` to `CacheEntry` | **Imprecise** — it's an option, not a hook field |
| Resource has `_key` for snapshot labeling | Field is `argsKey`; devtools key comes from `keyParts` in options | **Imprecise** — name differs |

**Severity: Low.** The asymmetry is real (Command doesn't pass devtools options) but the field names cited are not actual field names.

---

## 4. State Machine States

### Resource Machines

| Report | Source | Status |
|---|---|---|
| `MachinePending` | `export class MachinePending<TArgs, TData>` | ✓ |
| `MachineSuccess` | `export class MachineSuccess<TArgs, TData> extends MachineWithData<TArgs, TData>` | ✓ |
| `MachineRefreshing` | `export class MachineRefreshing<TArgs, TData> extends MachineWithData<TArgs, TData>` | ✓ |
| `MachineError` | `export class MachineError<TArgs, TData>` | ✓ |
| `MachineWithData` abstract base | `export abstract class MachineWithData<TArgs, TData>` | ✓ |
| "patch methods for Success and Refreshing" | Only Success + Refreshing extend MachineWithData | ✓ |

### Command Machines

| Report | Source | Status |
|---|---|---|
| `CommandIdle` | Present; `/** Stub — full implementation in Phase 2 */` | ✓ |
| `CommandLoading` | Present; Phase 2 stub | ✓ |
| `CommandSuccess` | Present; Phase 2 stub | ✓ |
| `CommandError` | Present; Phase 2 stub | ✓ |
| "Phase 2 stub" comments on all 4 | Confirmed in all 4 files | ✓ |
| "No shared base" | None extend MachineWithData or any shared class | ✓ |

### Executive Summary Mermaid Claim

Report says ResourceCacheEntry has "4 machine states via MachineWithData". **Slightly misleading** — only MachineSuccess and MachineRefreshing extend MachineWithData; MachinePending and MachineError are standalone. The §2 text correctly clarifies this.

**Severity: Low.**

---

## 5. Inheritance Hierarchy

| Claim | Source | Status |
|---|---|---|
| `CacheEntry <\|-- ResourceCacheEntry` | `extends CacheEntry<TMachineInstance<TArgs, TData>>` | ✓ |
| `CacheEntry <\|-- CommandCacheEntry` | `extends CacheEntry<TCommandMachineInstance<TArgs, TResult>>` | ✓ |
| Two-level hierarchy (no intermediary) | Confirmed — no FetchableCacheEntry or similar | ✓ |

---

## 6. Duplication Inventory Line Numbers

This is the area with the most inaccuracies. Spot-checked all 16 patterns against actual source.

### ResourceCacheEntry Line References

| Pattern | Report Line | Actual Line | Delta | Severity |
|---|---|---|---|---|
| #1 `_abortController` field | :48 | :48 | 0 | ✓ |
| #2 `_entryRemoved` field | :54 | :54 | 0 | ✓ |
| #3 Abort teardown in `complete()` | :146–149 | :147–150 | +1 | Low |
| #4 `_entryDataLoaded` reject | :154–157 | :155–158 | +1 | Low |
| #5 `_entryRemoved` resolve | :158–161 | :159–162 | +1 | Low |
| #6 `_queryFulfilled` reject | :162–165 | :163–166 | +1 | Low |
| #7 `super.complete()` | :168 | :169 | +1 | Low |
| #8 `_fireCacheEntryAdded` | :171–186 | :172–195 | +1 (start), end wrong | Low |
| #9 `_queryFulfilled` "superseded" | :203–206 | :210–213 | +7 | Medium |
| #10 `_onQueryStarted` guard | :209–221 | :216–228 | +7 | Medium |
| #11 Abort prev controller | :193–195 | :199–201 | +6 | Medium |
| #12 Create new AbortController | :200–201 | :206–207 | +6 | Medium |
| #13 `_entryDataLoaded` resolve (success) | :272–275 | :272–275 | 0 | ✓ |
| #14 `_queryFulfilled` resolve (success) | :278–281 | :278–281 | 0 | ✓ |
| #15 `_queryFulfilled` reject (error) | :316–319 | :309–312 | −7 | Medium |
| #16 `_queryFulfilled` reject (sync error) | :231–234 | :238–241 | +7 | Medium |

**Pattern:** Field declarations (#1, #2) and success handler (#13, #14) are correct. `complete()` body is off by +1 consistently. `_doFetch()` interior is off by ±6–7 lines.

### CommandCacheEntry Line References

| Pattern | Report Line | Actual Line | Delta | Severity |
|---|---|---|---|---|
| #1 `_abortController` field | :30 | :30 | 0 | ✓ |
| #2 `_entryRemoved` field | :34 | :34 | 0 | ✓ |
| #3 Abort teardown in `complete()` | **:225–228** | **:251–254** | **+26** | **Critical** |
| #4 `_entryDataLoaded` reject | **:235–238** | **:261–264** | **+26** | **Critical** |
| #5 `_entryRemoved` resolve | **:239–242** | **:265–268** | **+26** | **Critical** |
| #6 `_queryFulfilled` reject | **:243–246** | **:269–272** | **+26** | **Critical** |
| #7 `super.complete()` | **:248** | **:274** | **+26** | **Critical** |
| #8 `_fireCacheEntryAdded` | **:250–265** | **:277–292** | **+27** | **Critical** |
| #9 `_queryFulfilled` "superseded" | :97–100 | :92–95 | −5 | Medium |
| #10 `_onQueryStarted` guard | :103–115 | :98–110 | −5 | Medium |
| #11 Abort prev controller | :56–58 | :50–52 | −6 | Medium |
| #12 Create new AbortController | :67–68 | :61–62 | −6 | Medium |
| #13 `_entryDataLoaded` resolve (success) | **:159–162** | **:183–186** | **+24** | **Critical** |
| #14 `_queryFulfilled` resolve (success) | **:165–168** | **:189–192** | **+24** | **Critical** |
| #15 `_queryFulfilled` reject (error) | **:186–189** | **:220–223** | **+34** | **Critical** |
| #16 `_queryFulfilled` reject (sync error) | :130–133 | :131–134 | +1 | Low |

**Critical finding:** 9 of 16 CommandCacheEntry line references are wrong by 24–34 lines. The `complete()` and `_fireCacheEntryAdded` block references (~225–265) actually point into the `initiate()` error handler and `resetToIdle()` areas, not the `complete()` method at all. The `initiate()` interior references are off by 5–6 lines in the opposite direction.

**Severity: Medium (aggregate).** The duplication patterns themselves are real and correctly described — it's only the line number citations that are wrong. The code blocks ARE literally identical as claimed. No pattern points to non-existent code.

---

## 7. Duplication Count Methodology

### Pattern #8: `_fireCacheEntryAdded` — "8 IDENTICAL" Lines

The report claims 8 literally identical lines. Actual comparison:

| Line Content | Identical? |
|---|---|
| `private _fireCacheEntryAdded(): void {` | ✓ |
| `if (!this._onCacheEntryAdded) return;` | ✓ |
| `this._entryDataLoaded = new PromiseResolver<TData/TResult>()` | **No** — type param differs |
| `this._entryRemoved = new PromiseResolver<void>();` | ✓ |
| Tools type annotation | **No** — `ICacheEntryAddedTools<TData>` vs `ICommandCacheEntryAddedTools<TResult>` |
| `$cacheDataLoaded: this._entryDataLoaded.promise,` | ✓ |
| `$cacheEntryRemoved: this._entryRemoved.promise,` | ✓ |
| `};` | ✓ |
| `try {` | ✓ |
| Callback invocation | **No** — `(this._args, tools)` vs `(tools)` |
| `} catch {` | ✓ |
| Comment | **No** — "are caught, not propagated" vs "caught" |
| `}` | ✓ |

Truly literally-identical non-trivial lines: ~5–6. Structural boilerplate (`try {`, `} catch {`, `}`) is trivially identical. The "8 IDENTICAL" count appears to include lines with differing type parameters and callback signatures, which are more accurately "structurally similar."

**Severity: Low.** Doesn't materially affect the report's conclusion since the overall 57-line total could be off by ~3–5 lines, and the report's argument stands regardless (duplication is small and fragmented).

---

## 8. Other Verified Claims

| Claim | Status |
|---|---|
| Stale check: Resource uses identity (`!== controller`), Command uses `.aborted` | ✓ Confirmed |
| Command uses `Batcher.run()` in success/error paths | ✓ Confirmed |
| Resource `_fireCacheEntryAdded` has hydration check; Command does not | ✓ Confirmed |
| `_onCacheEntryAdded` called with `(args, tools)` in Resource, `(tools)` in Command | ✓ Confirmed |
| `onQueryStarted` tools: Resource has `getCacheEntry`, Command does not | ✓ Confirmed |
| Command `complete()` rejects `_triggerResolver`; Resource cleans `_inflightPromise` | ✓ Confirmed |
| All 4 Command machines have "Phase 2 stub" comments | ✓ Confirmed |
| Only MachineSuccess and MachineRefreshing extend MachineWithData | ✓ Confirmed |
| MachinePending and MachineError are standalone (no shared base) | ✓ Confirmed |
| CacheEntry default `_cacheLifetime = 60_000` (60s) | ✓ Confirmed |
| `10.5%` duplication rate (57/545) | ✓ Arithmetic correct |

---

## Summary of Issues

| # | Issue | Location | Severity |
|---|---|---|---|
| 1 | CacheEntry total lines: 76 → actual 72 | Executive summary, §2 | **Medium** |
| 2 | CacheEntry LOC: 74 → actual 61 | §2 | **Medium** |
| 3 | Resource path casing: `Resource/` → actual `resource/` | §2 | Low |
| 4 | CommandCacheEntry line numbers in duplication inventory off by 24–34 (complete/fireCacheEntryAdded/success/error blocks) | §3 Table, 9 of 16 patterns | **Medium** |
| 5 | ResourceCacheEntry line numbers in `_doFetch()` off by ±6–7 | §3 Table, 6 of 16 patterns | Low |
| 6 | Pattern #8 "8 IDENTICAL" includes ~3 lines that differ (type params, callback args, comments) | §3 Table | Low |
| 7 | Asymmetry table: `_beforeDevtoolsPush` and `_key` aren't actual field names | §2 Key Asymmetries | Low |

**No critical factual errors that affect the report's conclusions.** The CacheEntry LOC error and line number offsets are documentation accuracy issues. The duplication patterns are real, correctly described, and the code comparison is accurate. The architectural analysis, OSS comparison, approach evaluations, and recommendation are all technically sound.
