import type { TResourcesInput, TResourcesState } from "@/query/types";

import { useResourcesStore } from "./useResourcesStore";

/**
 * Observe several resources at once: named slots (a record) or an array of
 * bound resources (`resource.bind(args)`); a slot can be `SKIP`. A literal
 * tuple stays a tuple in `states` and `data`, `ids.map(...)` is an array.
 *
 * - `states` — every slot's clutch state, the shape `useResource` returns;
 * - `hasData` / `data` — every engaged slot has data (a `SKIP` slot is
 *   `null`); `[]` / `{}` have data at once, an all-`SKIP` input is `idle`;
 * - `status` — `idle` (every slot is `SKIP`), `pending` (some slot has a
 *   query in flight), `error` (some slot failed), `success`;
 * - the loading flags say "some slot is like this", `error` is the first slot
 *   error in slot order;
 * - `retry` / `invalidate` act on every slot.
 *
 * A named slot keeps SWR across an args change, as `useResource`; an array
 * slot does not — an index is no identity. For one stale list across a set
 * change use a projection resource.
 *
 * @param resources - A record or an array of bound resources or `SKIP`.
 */
export function useResources<const T extends TResourcesInput>(resources: T): TResourcesState<T> {
    return useResourcesStore(resources, "useResources", true).state as TResourcesState<T>;
}
