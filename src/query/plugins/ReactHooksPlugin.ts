import { useCommandAgent, useResourceAgent } from "@/query/react";
import type {
    ArgsOrVoidOrSkip,
    ICommand,
    IPlugin,
    IPluginContext,
    IResource,
    TCommandOptions,
    TResourceOptions,
} from "@/query/types";

export class ReactHooksPlugin implements IPlugin {
    readonly name = "ReactHooksPlugin" as const;

    install(_context: IPluginContext): void {
        // No global setup needed for React hooks
    }

    augmentResource<TArgs, TData>(
        resource: IResource<TArgs, TData>,
        _options: TResourceOptions<TArgs, TData>,
    ): Record<string, unknown> {
        return {
            useResourceAgent(...args: ArgsOrVoidOrSkip<TArgs>) {
                return useResourceAgent(resource, ...args);
            },
        };
    }

    augmentCommand<TArgs, TResult>(
        command: ICommand<TArgs, TResult>,
        _options: TCommandOptions<TArgs, TResult>,
    ): Record<string, unknown> {
        return {
            useCommandAgent() {
                return useCommandAgent(command);
            },
        };
    }
}
