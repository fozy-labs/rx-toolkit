import { useResourceV2Agent } from "@/query-v2/react";
import type { ArgsOrVoidOrSkip, IPlugin, IPluginContext, IResourceV2, TResourceV2Options } from "@/query-v2/types";

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
}
