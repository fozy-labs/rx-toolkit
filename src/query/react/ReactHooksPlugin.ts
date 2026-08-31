import type {
    ArgsOrVoid,
    ArgsOrVoidOrSkip,
    ICommand,
    IPlugin,
    IPluginContext,
    IResource,
    PluginHKT,
    TCommandAgentState,
    TCommandOptions,
    TInfiniteResourceState,
    TProjectionResourceOptions,
    TResourceAgentState,
    TResourceOptions,
    TSuspenseResourceState,
    TTriggerPromise,
} from "@/query/types";

import { useCommand } from "./useCommand";
import { useInfiniteResource } from "./useInfiniteResource";
import { useResource } from "./useResource";
import { useSuspenseResource } from "./useSuspenseResource";

/** Resource augmentation shape produced by ReactHooksPlugin. */
type ReactHooksResourceShape<TArgs, TData, TError> = {
    useResource: (args: ArgsOrVoidOrSkip<TArgs>) => TResourceAgentState<TArgs, TData, TError>;
    useSuspenseResource: (args: ArgsOrVoid<TArgs>) => TSuspenseResourceState<TArgs, TData, TError>;
};

/** Additional augmentation for projection resources (on top of the resource shape). */
type ReactHooksProjectionResourceShape<TArgs, TData, TError> = {
    useInfiniteResource: (initialArgs: ArgsOrVoidOrSkip<TArgs>) => TInfiniteResourceState<TArgs, TData, TError>;
};

/** Command augmentation shape produced by ReactHooksPlugin. */
type ReactHooksCommandShape<TArgs, TData, TError> = {
    useCommand: (
        key?: string,
    ) => [trigger: (args: TArgs) => TTriggerPromise<TData, TError>, state: TCommandAgentState<TArgs, TData, TError>];
};

/**
 * HKT declaration for ReactHooksPlugin.
 * Uses `this['_TArgs']`, `this['_TData']`, and `this['_TError']` which become
 * concrete when applied through `ApplyPluginResourceHKT` / `ApplyPluginCommandHKT`.
 */
export interface ReactHooksPluginHKT extends PluginHKT {
    readonly resourceType: ReactHooksResourceShape<this["_TArgs"], this["_TData"], this["_TError"]>;
    readonly commandType: ReactHooksCommandShape<this["_TArgs"], this["_TData"], this["_TError"]>;
    readonly projectionResourceType: ReactHooksProjectionResourceShape<this["_TArgs"], this["_TData"], this["_TError"]>;
}

export class ReactHooksPlugin implements IPlugin {
    readonly name = "ReactHooksPlugin";

    declare readonly _hkt: ReactHooksPluginHKT;

    install(_context: IPluginContext): void {
        // no-op
    }

    augmentResource<TArgs, TData, TError = unknown>(
        resource: IResource<TArgs, TData, TError>,
        _options: TResourceOptions<TArgs, TData>,
    ): ReactHooksResourceShape<TArgs, TData, TError> {
        return {
            useResource: (args: ArgsOrVoidOrSkip<TArgs>) => useResource(resource, args),
            useSuspenseResource: (args: ArgsOrVoid<TArgs>) => useSuspenseResource(resource, args),
        };
    }

    augmentCommand<TArgs, TData, TError = unknown>(
        command: ICommand<TArgs, TData, TError>,
        _options: TCommandOptions<TArgs, TData>,
    ): ReactHooksCommandShape<TArgs, TData, TError> {
        return {
            useCommand: (key?: string) => useCommand(command, key),
        };
    }

    augmentProjectionResource<TArgs, TId, TItem, TResArgs, TResData, TError = unknown>(
        resource: IResource<TArgs, TItem[], TError>,
        _options: TProjectionResourceOptions<TArgs, TId, TItem, TResArgs, TResData>,
    ): ReactHooksProjectionResourceShape<TArgs, TItem[], TError> {
        return {
            useInfiniteResource: (initialArgs: ArgsOrVoidOrSkip<TArgs>) => useInfiniteResource(resource, initialArgs),
        };
    }
}

export function reactHooksPlugin(): ReactHooksPlugin {
    return new ReactHooksPlugin();
}
