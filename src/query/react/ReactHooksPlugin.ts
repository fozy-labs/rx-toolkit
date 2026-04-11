import type {
    ArgsOrVoidOrSkip,
    ICommand,
    IPlugin,
    IPluginContext,
    IResource,
    PluginHKT,
    TCommandAgentState,
    TCommandOptions,
    TResourceAgentState,
    TResourceOptions,
} from "@/query/types";

import { useCommand } from "./useCommand";
import { useResource } from "./useResource";

/** Resource augmentation shape produced by ReactHooksPlugin. */
type ReactHooksResourceShape<TArgs, TData> = {
    useResource: (args: ArgsOrVoidOrSkip<TArgs>) => TResourceAgentState<TArgs, TData>;
};

/** Command augmentation shape produced by ReactHooksPlugin. */
type ReactHooksCommandShape<TArgs, TData> = {
    useCommand: (key?: string) => [trigger: (args: TArgs) => Promise<TData>, state: TCommandAgentState<TArgs, TData>];
};

/**
 * HKT declaration for ReactHooksPlugin.
 * Uses `this['_TArgs']` and `this['_TData']` which become concrete when
 * applied through `ApplyPluginResourceHKT` / `ApplyPluginCommandHKT`.
 */
export interface ReactHooksPluginHKT extends PluginHKT {
    readonly resourceType: ReactHooksResourceShape<this["_TArgs"], this["_TData"]>;
    readonly commandType: ReactHooksCommandShape<this["_TArgs"], this["_TData"]>;
}

export class ReactHooksPlugin implements IPlugin {
    readonly name = "ReactHooksPlugin";

    declare readonly _hkt: ReactHooksPluginHKT;

    install(_context: IPluginContext): void {
        // no-op
    }

    augmentResource<TArgs, TData>(
        resource: IResource<TArgs, TData>,
        _options: TResourceOptions<TArgs, TData>,
    ): { useResource: (args: ArgsOrVoidOrSkip<TArgs>) => TResourceAgentState<TArgs, TData> } {
        return {
            useResource: (args: ArgsOrVoidOrSkip<TArgs>) => useResource(resource, args),
        };
    }

    augmentCommand<TArgs, TData>(
        command: ICommand<TArgs, TData>,
        _options: TCommandOptions<TArgs, TData>,
    ): {
        useCommand: (
            key?: string,
        ) => [trigger: (args: TArgs) => Promise<TData>, state: TCommandAgentState<TArgs, TData>];
    } {
        return {
            useCommand: (key?: string) => useCommand(command, key),
        };
    }
}

export function reactHooksPlugin(): ReactHooksPlugin {
    return new ReactHooksPlugin();
}
