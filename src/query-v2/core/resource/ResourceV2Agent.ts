import { SKIP, type SKIP_TOKEN } from "@/query-v2/lib/SKIP_TOKEN";
import type { ArgsOrVoidOrSkip, IResourceV2Agent, TResourceV2AgentState } from "@/query-v2/types";
import { type ReadableSignalFnLike, Signal } from "@/signals";
import type { ComputeFn } from "@/signals/types";

import type { ResourceV2CacheEntry } from "./ResourceV2CacheEntry";

interface Tracking<TArgs, TData> {
    args: TArgs;
    current$: ReadableSignalFnLike<ResourceV2CacheEntry<TArgs, TData>>;
}

export class ResourceV2Agent<TArgs, TData> implements IResourceV2Agent<TArgs, TData> {
    private _getEntry$;
    private _compareArgsFn;

    private _previous$: ReadableSignalFnLike<ResourceV2CacheEntry<TArgs, TData>> | null = null;

    private _tracking$ = Signal.state<Tracking<TArgs, TData> | null>(null, {
        isDisabled: true,
    });

    readonly state$: ComputeFn<TResourceV2AgentState<TArgs, TData>>;

    constructor(
        getEntry$: (args: TArgs) => ResourceV2CacheEntry<TArgs, TData>,
        compareArgs: (a: TArgs, b: TArgs) => boolean,
    ) {
        this._getEntry$ = getEntry$;
        this._compareArgsFn = compareArgs;

        this.state$ = Signal.compute<TResourceV2AgentState<TArgs, TData>>(() => {
            return this._deriveState$();
        }, {
            isDisabled: true,
        });
    }

    start(...args: ArgsOrVoidOrSkip<TArgs>): void {
        const newArgs = args.length > 0
            ? (args[0] as TArgs | SKIP_TOKEN)
            : (undefined as unknown as TArgs);

        // If SKIP, clearing tracking (no current or previous), but keep args as NONE to distinguish from initial state
        if (newArgs === SKIP) {
            this._previous$ = null;
            this._tracking$.set(null);
            return;
        }

        const tracking = this._tracking$.peek();

        if (tracking && this.compareArgs(tracking.args, newArgs)) {
            return;
        }

        // Different args, start new query and move current to previous (if previous data loaded)
        let previous$ = tracking?.current$ ?? null;

        if (previous$) {
            const status = previous$.peek().machine$.peek().status;

            if (status !== "success" && status !== "refreshing") {
                previous$ = null;
            }
        }

        const current$ = Signal.compute(() => {
            return this._getEntry$(newArgs);
        }, {
            isDisabled: true,
        });

        this._previous$ = previous$;
        this._tracking$.set({
            args: newArgs,
            current$,
        });
    }

    compareArgs(a: TArgs, b: TArgs): boolean {
        return this._compareArgsFn(a, b);
    }

    private _idleState(): TResourceV2AgentState<TArgs, TData> {
        return {
            status: "idle",
            data: null,
            error: null,
            args: null,
            isLoading: false,
            isInitialLoading: false,
            isRefreshing: false,
            isSuccess: false,
            isError: false,
            entry: null,
        };
    }

    private _deriveState$(): TResourceV2AgentState<TArgs, TData> {
        const tracking = this._tracking$();
        const previous$ = this._previous$;

        if (tracking === null) {
            return this._idleState();
        }

        const { current$, args } = tracking;

        const currentEntry = current$();

        const currentMachine = currentEntry.machine$();
        let status = currentMachine.status;

        // SWR data: use previous entry's data while current is loading
        let data: TData | null = currentMachine.data ?? null;

        if ((status === "pending" || status === 'error') && previous$) {
            const prevMachine = previous$().machine$();

            if (prevMachine.status === "success" || prevMachine.status === "refreshing") {
                data = prevMachine.data;
                status = "refreshing";
            }
        }

        const isLoading = status === "pending" || status === "refreshing";
        const isInitialLoading = isLoading && data === null;
        const isRefreshing = status === "refreshing";

        // Clear previous when current resolves
        if (previous$ && (status === "success" || status === "error")) {
            this._previous$ = null;
        }

        return {
            status,
            args,
            data,
            error: currentMachine.error ?? null,
            isLoading,
            isInitialLoading,
            isRefreshing,
            isSuccess: status === "success",
            isError: status === "error",
            entry: currentEntry,
        };
    }
}
