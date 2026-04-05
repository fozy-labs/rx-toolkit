# Research: Duplication between usage/resource.md and api/resource.md

**Rule reference**: common-mistakes.md #3 — "Before writing any section, check if it exists in another doc. If so, link to it."

---

## 1. EXACT duplicated sections

### 1A. Options table

| File | Section heading | Lines |
|------|----------------|-------|
| `usage/resource.md` | `## Опции` | L25–L35 |
| `api/resource.md` | `## Опции` | L15–L27 |

**Overlap**: Both files list the SAME 6 options (`queryFn`, `key`, `cacheRetentionTime`, `serializeArgs`, `onCacheEntryAdded`, `onQueryStarted`) with the same types and descriptions. The api/ version has slightly more precise type annotations (e.g., `(args: TArgs, abortSignal: AbortSignal) => Promise<TData>` vs `(args, abortSignal) => Promise<TData>`). The api/ version also has reference-style links to lifecycle hooks section in usage/.

**Verdict**: FULL DUPLICATION. The api/ version is the canonical reference.

### 1B. Methods/API table

| File | Section heading | Lines |
|------|----------------|-------|
| `usage/resource.md` | `## API ресурса` | L38–L49 |
| `api/resource.md` | `## Методы` | L30–L43 |

**Overlap**: Both files list the SAME 7 methods (`useResource`, `trigger`, `refresh`, `getEntry`, `getEntry$`, `createAgent`, `link`) with descriptions. The api/ version adds explicit parameter types and return types in dedicated columns. The usage/ version has longer prose descriptions.

**Verdict**: FULL DUPLICATION. The api/ version is the canonical, more precise reference.

### 1C. Creation code example

| File | Section heading | Lines |
|------|----------------|-------|
| `usage/resource.md` | `## Создание ресурса` | L9–L18 |
| `api/resource.md` | `## Создание` | L7–L15 |

**Overlap**: Nearly identical `createResource` examples (same `queryFn` with fetch, same structure). api/ version adds `key: 'users'`. usage/ version has a more detailed explanation paragraph after the example.

**Verdict**: DUPLICATION with minor variation. api/ has the minimal canonical example.

---

## 2. Replacement strategy for each duplicated section in usage/resource.md

### 2A. Options table (L25–L35) → REMOVE, replace with cross-reference

The options table is a pure API reference artifact. usage/resource.md should NOT contain it.

**Replace with**: One sentence + link:
> Полный список опций — см. [API ресурса][api-resource]. Ниже рассматриваются только опции, влияющие на поведение.

Then keep ONLY the lifecycle hooks section (`onCacheEntryAdded`, `onQueryStarted`) at the bottom of the file, since those have usage-specific examples and patterns. The lifecycle section is already separate — it just needs the options table removed.

### 2B. Methods/API table (L38–L49) → REMOVE, replace with cross-reference

The methods table is also a pure API reference. usage/ should demonstrate HOW to use the methods, not list them.

**Replace with**: One sentence + link:
> Полный список методов — см. [API ресурса][api-resource].

The imperative API section further down (L138–L179) already demonstrates `trigger`, `refresh`, `getEntry`, `getEntry$`, `createAgent` with examples — that's the proper usage-level content. No table needed.

### 2C. Creation example (L9–L18) → KEEP simplified version

The creation example in usage/ serves as the ENTRY POINT for the guide. Removing it would make the doc start with abstract concepts. However, the explanatory paragraph about `queryFn` (L20–L21) adds context not present in api/.

**Recommendation**: KEEP the creation example as-is. It's the natural opening for a usage guide. The slight duplication is justified per common-mistakes.md #3: "Only duplicate when truly necessary (use 'smart' judgment)." A usage guide without a creation example would be incomplete.

---

## 3. Content UNIQUE to usage/resource.md — MUST STAY

### 3A. React: useResource (L52–L78)
- Plugin setup example (`reactHooksPlugin()`)
- Full JSX component example with loading/error/data rendering
- Behavioral description (4-point list: mount → args change → unmount → remount)

**Not in api/**: api/ only has a one-line table entry for `useResource`.

### 3B. Conditional queries / SKIP (L81–L101)
- Full example with `SKIP` in a component
- Behavioral explanation ("SKIP полностью останавливает наблюдение")

**Not in api/**: api/ doesn't cover SKIP usage patterns at all.

### 3C. Resource states table (L104–L120)
- Full state fields table (`status`, `data`, `error`, boolean flags)
- 6 possible statuses including `refresh-error`

**Not in api/**: api/ only references `TResourceState<TData>` as return type but doesn't enumerate fields.

### 3D. Refresh behavior / SWR explanation (L122–L130)
- Prose explaining background refresh semantics
- "Smooth argument switching" SWR behavior description

**Not in api/**: api/ has a one-line description in the methods table.

### 3E. Imperative API examples (L133–L179)
- `trigger` with code example + deduplication explanation
- `refresh` with code example + subscriber behavior
- `getEntry` with code example + `doInitiate` explanation
- `getEntry$` with reactive context example
- `createAgent` with detailed SWR behavior explanation and code examples

**Not in api/**: api/ only has table entries. These usage examples are essential.

### 3F. Lifecycle hooks with examples (L183–L229)
- `onCacheEntryAdded` with full callback example + "typical use: WebSocket subscription"
- `onQueryStarted` with full callback example + "typical use: updating related caches"

**Not in api/**: api/ only has type signatures and links BACK to this section.

---

## 4. Summary action plan

| Section in usage/resource.md | Lines | Action | Replacement |
|------------------------------|-------|--------|-------------|
| `## Опции` (table) | L25–L35 | **REMOVE** | Cross-ref to `api/resource.md#опции` |
| `## API ресурса` (table) | L38–L49 | **REMOVE** | Cross-ref to `api/resource.md#методы` |
| `## Создание ресурса` | L9–L21 | **KEEP** | Justified as usage guide entry point |
| `## React: useResource` | L52–L78 | **KEEP** | Unique usage content |
| `## Условные запросы` | L81–L101 | **KEEP** | Unique usage content |
| `## Состояния ресурса` | L104–L130 | **KEEP** | Unique usage content |
| `## Императивный API` | L133–L197 | **KEEP** | Unique usage content |
| `## Хуки жизненного цикла` | L199–L229 | **KEEP** | Unique usage content (api/ links here) |
| `## См. также` | L232–L234 | **KEEP + extend** | Add link to api/resource.md |

**Net result**: Remove ~25 lines (two tables), add ~4 lines (two cross-references + api/resource link in "См. также"). All unique content preserved.
