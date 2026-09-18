import type { IResource, TArgsOrVoidOrSkip, TResourceClutchState } from "@/query/types";
import { useSignal } from "@/signals/react";

import { useResourceClutch } from "./useResourceClutch";

export function useResource<TArgs, TData, TError = unknown>(
    resource: IResource<TArgs, TData, TError>,
    args: TArgsOrVoidOrSkip<TArgs>,
): TResourceClutchState<TArgs, TData, TError> {
    const clutch = useResourceClutch(resource, args, false);

    return useSignal(clutch.state$);
}
