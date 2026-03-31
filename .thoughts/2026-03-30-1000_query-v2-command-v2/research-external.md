---
title: "External Research: Mutation/Command Patterns in Modern Query Libraries"
date: 2026-03-30
stage: 01-research
role: rdpi-external-researcher
---

## Comparative Analysis

| Aspect | TanStack Query v5 `useMutation` | RTK Query `build.mutation` | SWR `useSWRMutation` |
|---|---|---|---|
| **State shape** | `{ status, data, error, variables, submittedAt, isPending, isIdle, isSuccess, isError }` | `{ data, error, isUninitialized, isLoading, isSuccess, isError, reset }` | `{ data, error, trigger, reset, isMutating }` |
| **Trigger pattern** | `mutate(vars)` / `mutateAsync(vars)` — returned from hook | `[trigger, result] = useMutation()` — tuple; `trigger(arg).unwrap()` for promise | `trigger(arg, options?)` — returned from hook |
| **Definition site** | Inline `mutationFn` in hook or via `mutationKey` + defaults | `build.mutation<Return, Arg>({ query, invalidatesTags })` in `createApi` endpoint builder | `useSWRMutation(key, fetcher)` — fetcher receives `(key, { arg })` |
| **Lifecycle hooks** | `onMutate`, `onSuccess`, `onError`, `onSettled` — on both definition and `mutate()` call site | `onQueryStarted`, `onCacheEntryAdded` — on endpoint definition only | `onSuccess`, `onError` — on hook options only |
| **Optimistic: via UI** | Return `variables` from hook; render pending item with `isPending` flag; no cache touch needed | N/A (not a documented pattern) | N/A (not a documented pattern) |
| **Optimistic: via cache** | In `onMutate`: `cancelQueries` → snapshot → `setQueryData` → return rollback; `onError` restores snapshot | In `onQueryStarted`: `dispatch(api.util.updateQueryData(...))` → `queryFulfilled` catch → `undo()` | `optimisticData` option (value or `current => newData` fn); `rollbackOnError: true\|fn` auto-reverts |
| **Cache invalidation** | Manual: `queryClient.invalidateQueries({ queryKey })` in `onSettled`/`onSuccess` | Declarative: `invalidatesTags: ['Post']` or `(result, error, arg) => [{ type, id }]` — automatic refetch of subscribed queries | `mutate(key)` triggers revalidation; `revalidate: true` (default) on mutation completion; filter fn for bulk invalidation |
| **Tag system** | None built-in; invalidation by query key matching | `tagTypes` + `providesTags` / `invalidatesTags` with `{ type, id }` granularity; supports abstract IDs like `'LIST'` | None; key-based matching; filter fn `(key) => boolean` for bulk |
| **Scoping / dedup** | `scope: { id }` — serializes mutations with same scope ID | `fixedCacheKey` — shares mutation result across hook instances | Each `useSWRMutation` instance is independent; shares cache store with `useSWR` for race-condition avoidance |
| **Retry** | `retry: number` (default: 0 for mutations) | Inherited from `baseQuery`; no mutation-specific retry by default | Not documented for `useSWRMutation` |
| **Persistence** | `dehydrate`/`hydrate` + `resumePausedMutations` for offline support | Via Redux persist (external) | Not built-in |
| **Reset** | `mutation.reset()` clears data/error | `reset()` on mutation result | `reset()` on hook return |
| **Confidence** | **High** (official docs) | **High** (official docs) | **High** (official docs) |

## Established Practices

- **Trigger-on-demand**: All three libraries use an explicit trigger function (not auto-execute). Mutations are never fired on mount. **High confidence** — consistent across all three.
- **Optimistic update + rollback**: TanStack and SWR both provide first-class rollback. RTK Query uses `onQueryStarted` + `undo()` patches. All three snapshot-then-restore. **High confidence**.
- **Separation from queries**: Mutations are a distinct concept from queries in all libraries — separate hooks, separate state machines, no shared loading states. **High confidence**.
- **Post-mutation revalidation**: All three default to refetching affected queries after mutation settles. The mechanism differs: TanStack = manual `invalidateQueries`, RTK Query = declarative tags, SWR = automatic `revalidate: true`. **High confidence**.

## Opinions and Speculation

- TkDodo (TanStack maintainer) recommends the "optimistic via UI" pattern over cache manipulation for simpler cases — fewer moving parts, no rollback needed. **Medium confidence** (single authoritative source: TkDodo's blog).
- RTK Query's tag system is considered more verbose but more predictable for large apps by community consensus. **Low confidence** (community opinion, no benchmark).

## Pitfalls

- **TanStack**: `mutate()` callbacks (onSuccess/onError) on the call-site only fire for the *last* consecutive mutation if multiple are in flight. Use `useMutation`-level callbacks for per-call effects. **High** — documented.
- **TanStack**: `onMutate` must `cancelQueries` before snapshot to avoid refetch overwriting optimistic data. **High** — documented.
- **RTK Query**: `invalidatesTags` with general tags (`['Post']`) invalidates ALL queries providing any `Post` tag — can cause N+1 refetch storms. Use `{ type, id: 'LIST' }` pattern. **High** — documented.
- **RTK Query**: `fixedCacheKey` loses `originalArgs` — can't reconstruct mutation context from shared result. **High** — documented.
- **SWR**: `useSWRMutation` instances don't share state — if two components use the same key, they won't see each other's `isMutating`. **High** — documented.

## Performance

No formal benchmarks found comparing mutation performance across libraries. The primary performance concern is cache invalidation granularity:
- RTK Query's tag system allows surgical invalidation (specific `{ type, id }`) vs. broad invalidation. **High** — documented pattern.
- TanStack Query's `queryKey` matching can use exact or fuzzy matching via `queryKey` prefix. **High** — documented.
- SWR's filter function approach is flexible but O(n) over all cache keys. **Medium** — inferred from API design.

## Sources

- [TanStack Query — Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) — state shape, lifecycle, scopes, persistence
- [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — UI-based and cache-based approaches
- [RTK Query — Mutations](https://redux-toolkit.js.org/rtk-query/usage/mutations) — endpoint builder, hook shape, `onQueryStarted`
- [RTK Query — Automated Refetching](https://redux-toolkit.js.org/rtk-query/usage/automated-refetching) — tag system, `providesTags`/`invalidatesTags`
- [SWR — Mutation & Revalidation](https://swr.vercel.app/docs/mutation) — `mutate`, `useSWRMutation`, optimistic updates, race conditions
