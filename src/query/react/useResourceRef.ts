import React from "react";
import { SKIP } from "@/query/SKIP_TOKEN";
import { shallowEqual } from "@/common/utils/shallowEqual";
import type { Prettify, ResourceDefinition, ResourceInstance, ResourceRefInstance } from "@/query/types";

type Result<D extends ResourceDefinition> = Prettify<ResourceRefInstance<D>>;

export function useResourceRef<D extends ResourceDefinition>(
    res: ResourceInstance<D>,
    ...argss: D['Args'] extends void ? [] | [typeof SKIP] : [D['Args'] | typeof SKIP]
): Result<D> {
    const args = (argss[0] === SKIP ? SKIP : argss[0]) as D['Args'] | typeof SKIP;

    const stableArgsRef = React.useRef(args);
    if (!shallowEqual(stableArgsRef.current, args)) {
        stableArgsRef.current = args;
    }

    return React.useMemo(() => {
        return res.createRef(stableArgsRef.current);
    }, [stableArgsRef.current]);
}
