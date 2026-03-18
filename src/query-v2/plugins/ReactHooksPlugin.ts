import React from "react";

import { useConstant } from "@/common/react/useConstant";
import { shallowEqual } from "@/common/utils/shallowEqual";
import type { ResourceV2 } from "@/query-v2/core/ResourceV2";
import { SKIP, type SKIP_TOKEN } from "@/query-v2/lib/SKIP_TOKEN";
import type { IResourceV2AgentState, IResourceV2Ref } from "@/query-v2/types/agent.types";
import type { TPatchFn } from "@/query-v2/types/machine.types";
import type { IPlugin, IPluginContext } from "@/query-v2/types/plugin.types";
import type { IResourceV2Options } from "@/query-v2/types/resource.types";
import { useSignal } from "@/signals/react/useSignal";
import type { ReadableSignalLike } from "@/signals/types";

/** Contributions added by ReactHooksPlugin to resources */
export interface IReactHooksPluginContributions<TArgs, TData, TError = Error> {
    useResourceV2Agent(args: TArgs | SKIP_TOKEN): IResourceV2AgentState<TArgs, TData, TError>;
    useResourceV2Ref(args: TArgs | SKIP_TOKEN): IResourceV2Ref<TArgs, TData, TError>;
}

// Wire type system via declaration merging (ADR-1)
declare module "@/query-v2/types/plugin.types" {
    interface PluginContributionMap<TArgs, TData, TError> {
        ReactHooksPlugin: IReactHooksPluginContributions<TArgs, TData, TError>;
    }
}

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

function useResourceV2Agent<TArgs, TData, TError>(
    resource: ResourceV2<TArgs, TData, TError>,
    args: TArgs | SKIP_TOKEN,
): IResourceV2AgentState<TArgs, TData, TError> {
    const prevArgsRef = React.useRef<TArgs | SKIP_TOKEN>(SKIP);

    const agent = useConstant(() => {
        const agent = resource.createAgent();

        if (args !== SKIP) {
            agent.start(args as TArgs);
        }

        return agent;
    });

    if (!compareArgs(args, prevArgsRef.current, resource)) {
        prevArgsRef.current = args;

        if (args !== SKIP) {
            agent.start(args as TArgs);
        }
    }

    return useSignal(agent.state$ as unknown as ReadableSignalLike<IResourceV2AgentState<TArgs, TData, TError>>);
}

function useResourceV2Ref<TArgs, TData, TError>(
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

function compareArgs<TArgs, TData, TError>(
    args: TArgs | SKIP_TOKEN,
    prevArgs: TArgs | SKIP_TOKEN,
    resource: ResourceV2<TArgs, TData, TError>,
): boolean {
    if (args === SKIP && prevArgs === SKIP) return true;
    if (args === SKIP || prevArgs === SKIP) return false;
    return resource.compareArgs(args as TArgs, prevArgs as TArgs);
}
