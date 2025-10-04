import { SKIP } from "query/SKIP_TOKEN";
import { ResourceDefinition, ResourceInstance, ResourceRefInstanse } from "query/types/Resource.types";
import { Prettify } from "query/types/shared.types";
import React from "react";

type Result<D extends ResourceDefinition> = Prettify<ResourceRefInstanse<D>> | null;

export function useResourceRef<D extends ResourceDefinition>(
    res: ResourceInstance<D>,
    ...argss: D['Args'] extends void ? [] | [typeof SKIP] : [D['Args'] | typeof SKIP]
): Result<D>{
    const args = (argss[0] === SKIP ? SKIP : argss[0]) as D['Args'] | typeof SKIP;

    return React.useMemo(() => {
        return res.createRef(args);
        }, [args]);
}
