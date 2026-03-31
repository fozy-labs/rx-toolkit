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
    TResourceOptions,
    IResource,
    IResourceCacheEntry,
    // agent.types
    TResourceAgentState,
    IResourceAgent,
    // lifecycle.types
    ICacheEntryAddedTools,
    IQueryStartedTools,
    TOnCacheEntryAdded,
    TOnQueryStarted,
    // snapshot.types
    TResourceSnapshotSlice,
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
    ICommandLinkOptions,
    CommandLink,
    TCommandOptions,
    ICommand,
    IResourceRef,
    TCommandAgentState,
    ICommandAgent,
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
export { commandLink } from "./api";

// React layer
export { useResourceAgent } from "./react";
export { useCommandAgent } from "./react";

// Plugins layer
export { ReactHooksPlugin } from "./plugins";
