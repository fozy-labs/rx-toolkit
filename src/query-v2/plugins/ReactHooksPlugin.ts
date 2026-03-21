import type { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import type { SKIP_TOKEN } from "@/query-v2/lib/SKIP_TOKEN";
import { useResourceV2Agent } from "@/query-v2/react/useResourceV2Agent";
import { useResourceV2Ref } from "@/query-v2/react/useResourceV2Ref";
import type { IResourceV2AgentState, IResourceV2Ref } from "@/query-v2/types/agent.types";
import type { IPlugin, IPluginContext } from "@/query-v2/types/plugin.types";
import type { IResourceV2Options } from "@/query-v2/types/resource.types";

/** Contributions added by ReactHooksPlugin to resources */
export interface IReactHooksPluginContributions<TArgs, TData, TError = Error> {
    useResourceV2Agent(args: TArgs | SKIP_TOKEN): IResourceV2AgentState<TArgs, TData, TError>;
    useResourceV2Ref(args: TArgs | SKIP_TOKEN): IResourceV2Ref<TArgs, TData, TError>;
}

// PluginContributionMap declaration merging is TypeScript type-level wiring that adds
// hook method types to resources when ReactHooksPlugin is included in the plugins tuple.
declare module "@/query-v2/types/plugin.types" {
    interface PluginContributionMap<TArgs, TData, TError> {
        ReactHooksPlugin: IReactHooksPluginContributions<TArgs, TData, TError>;
    }
}

/**
 * Plugin that attaches `useResourceV2Agent` and `useResourceV2Ref` as methods on resources via `augmentResource`.
 * Standalone imports from `@/query-v2/react/` are available as an alternative without requiring this plugin.
 */
export class ReactHooksPlugin implements IPlugin {
    readonly name = "ReactHooksPlugin" as const;
    private _context: IPluginContext | null = null;

    install(context: IPluginContext): void {
        this._context = context;
    }

    augmentResource<TArgs, TData, TError>(
        res: ResourceV2<TArgs, TData, TError>,
        _options: IResourceV2Options<TArgs, TData, TError>,
    ): Record<string, unknown> {
        return {
            useResourceV2Agent: (args: TArgs | SKIP_TOKEN) => useResourceV2Agent(res, args),
            useResourceV2Ref: (args: TArgs | SKIP_TOKEN) => useResourceV2Ref(res, args),
        };
    }
}
