import { useCommandV2Agent, useResourceV2Agent } from "@/query-v2/react";
import type {
    ArgsOrVoidOrSkip,
    ICommandV2,
    IPlugin,
    IPluginContext,
    IResourceV2,
    TCommandV2Options,
    TResourceV2Options,
} from "@/query-v2/types";

export class ReactHooksPlugin implements IPlugin {
    readonly name = "ReactHooksPlugin" as const;

    install(_context: IPluginContext): void {
        // No global setup needed for React hooks
    }

    augmentResource<TArgs, TData>(
        resource: IResourceV2<TArgs, TData>,
        _options: TResourceV2Options<TArgs, TData>,
    ): Record<string, unknown> {
        return {
            useResourceV2Agent(...args: ArgsOrVoidOrSkip<TArgs>) {
                return useResourceV2Agent(resource, ...args);
            },
        };
    }

    augmentCommand<TArgs, TResult>(
        command: ICommandV2<TArgs, TResult>,
        _options: TCommandV2Options<TArgs, TResult>,
    ): Record<string, unknown> {
        return {
            useCommandV2Agent() {
                return useCommandV2Agent(command);
            },
        };
    }
}
