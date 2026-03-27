// Sentinel tokens
export { SKIP, type SKIP_TOKEN } from "./lib/SKIP_TOKEN";

// Lib utilities
export { stableStringify } from "./lib";

// Types (explicit named exports — excludes internal cache types)
export type {
    // machine.types
    TMachineStatus,
    TPatchStatus,
    TPatch,
    TPatchState,
    TIdleState,
    TPendingState,
    TSuccessState,
    TErrorState,
    TRefreshingState,
    TMachineState,
    TMachineInstance,
    MachineWithData as TMachineWithData,
    IPatchHandle,
    CreatePatchResult,
    IMachineStatic,
    // resource.types
    TQueryFn,
    TSerializeArgsFn,
    TCompareArgsFn,
    IResourceV2Options,
    IResourceV2,
    IResourceV2CacheEntry,
    // agent.types
    IResourceV2AgentState,
    IResourceV2Agent,
    // lifecycle.types
    ICacheEntryAddedTools,
    IQueryStartedTools,
    TOnCacheEntryAdded,
    TOnQueryStarted,
    // snapshot.types
    TResourceV2SnapshotSlice,
    TResourceSnapshot,
    TApiSnapshot,
    // plugin.types
    IPluginContext,
    IPlugin,
    IReactHooksPluginContributions,
    PluginResourceContributions,
    PluginAugmentations,
    // api.types
    ICreateApiOptions,
    IApi,
    // shared.types
    ArgsOrVoid,
    ArgsOrVoidOrSkip,
    Prettify,
    UnionToIntersection,
} from "./types";

// Snapshot version constant (value export)
export { CURRENT_SNAPSHOT_VERSION } from "./types";

// Machine classes (public)
export {
    Machine,
    MachineIdle,
    MachinePending,
    MachineSuccess,
    MachineError,
    MachineRefreshing,
    MachineWithData,
    Patcher,
} from "./core/machines";

// API layer
export { createApi } from "./api";

// React layer
export { useResourceV2Agent } from "./react";

// Plugins layer
export { ReactHooksPlugin } from "./plugins";
