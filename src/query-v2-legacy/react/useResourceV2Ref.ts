import React from "react";

import { shallowEqual } from "@/common/utils/shallowEqual";
import type { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import { SKIP, type SKIP_TOKEN } from "@/query-v2/lib/SKIP_TOKEN";
import type { IResourceV2Ref } from "@/query-v2/types/agent.types";
import type { TPatchFn } from "@/query-v2/types/machine.types";

/**
 * React hook that provides an imperative ref handle for a cache entry (lock, invalidate, patch, create).
 *
 * @param resource - The resource to access.
 * @param args - Query arguments, or `SKIP_TOKEN` to return a no-op ref.
 * @returns Imperative ref with `has`, `lock`, `invalidate`, `createPatch`, `create`.
 * @see docs/query-v2/optimistic-updates.md
 */
export function useResourceV2Ref<TArgs, TData, TError>(
    resource: ResourceV2<TArgs, TData, TError>,
    args: TArgs | SKIP_TOKEN,
): IResourceV2Ref<TArgs, TData, TError> {
    const stableArgsRef = React.useRef(args);
    if (!shallowEqual(stableArgsRef.current, args)) {
        stableArgsRef.current = args;
    }

    return React.useMemo((): IResourceV2Ref<TArgs, TData, TError> => {
        if ((stableArgsRef.current as unknown) === SKIP) {
            return createSkippedRef<TArgs, TData, TError>();
        }
        return createRefHandle(resource, stableArgsRef.current as TArgs);
    }, [stableArgsRef.current]);
}

function createRefHandle<TArgs, TData, TError>(
    resource: ResourceV2<TArgs, TData, TError>,
    args: TArgs,
): IResourceV2Ref<TArgs, TData, TError> {
    return {
        get has(): boolean {
            return resource.hasEntry(args);
        },
        lock() {
            return resource.lockEntry(args);
        },
        invalidate() {
            resource.invalidate(args);
        },
        createPatch(patchFn: TPatchFn<TData>) {
            return resource.createEntryPatch(args, patchFn);
        },
        create(data: TData) {
            resource.populateEntry(args, data);
        },
    };
}

function createSkippedRef<TArgs, TData, TError>(): IResourceV2Ref<TArgs, TData, TError> {
    return {
        get has(): boolean {
            return false;
        },
        lock() {
            return { unlock: () => {} };
        },
        invalidate() {},
        createPatch() {
            return null;
        },
        create() {},
    };
}
