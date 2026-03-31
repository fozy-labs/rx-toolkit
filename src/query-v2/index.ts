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
    TResourceV2Options,
    IResourceV2,
    IResourceV2CacheEntry,
    // agent.types
    TResourceV2AgentState,
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
    // command-machine.types
    TCommandMachineStatus,
    TCommandIdleState,
    TCommandLoadingState,
    TCommandSuccessState,
    TCommandErrorState,
    TCommandMachineState,
    TCommandMachineInstance,
    // command-lifecycle.types
    ICommandCacheEntryAddedTools,
    ICommandQueryStartedTools,
    TOnCommandCacheEntryAdded,
    TOnCommandQueryStarted,
    // command.types
    TCommandQueryFn,
    ICommandV2LinkOptions,
    CommandV2Link,
    TCommandV2Options,
    ICommandV2,
    IResourceV2Ref,
    TCommandV2AgentState,
    ICommandV2Agent,
    // plugin.types (command additions)
    IReactHooksPluginCommandContributions,
    PluginCommandContributions,
    PluginCommandAugmentations,
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
    MachinePending,
    MachineSuccess,
    MachineError,
    MachineRefreshing,
    MachineWithData,
    Patcher,
} from "./core/machines";

// Command machine classes (public)
export { CommandIdle, CommandLoading, CommandSuccess, CommandError } from "./core/machines";

// API layer
export { createApi } from "./api";
export { _createCommandV2 } from "./api";
export { commandLink } from "./api";

// React layer
export { useResourceV2Agent } from "./react";
export { useCommandV2Agent } from "./react";

// Plugins layer
export { ReactHooksPlugin } from "./plugins";
