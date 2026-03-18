// Sentinel tokens
export { SKIP, type SKIP_TOKEN } from "./lib/SKIP_TOKEN";
export { NO_VALUE } from "./lib/NO_VALUE";
export type { NO_VALUE as NO_VALUE_TYPE } from "./lib/NO_VALUE";

// Utilities
export { stableStringify } from "./lib/stableStringify";

// Core — Machine classes
export {
    Machine,
    type TMachineInstance,
    MachineIdle,
    MachinePending,
    MachineSuccess,
    MachineError,
    MachineRefreshing,
    MachineWithData,
    Patcher,
    CacheEntry,
    type CacheEntryOptions,
    CacheMap,
    type TCacheMapInstance,
    LifecycleHooks,
    ResourceV2,
    type ResourceV2Config,
    ResourceV2Agent,
} from "./core";

// API factory
export { createApi } from "./api/createApi";

// Plugins
export { ReactHooksPlugin } from "./plugins/ReactHooksPlugin";
export type { IReactHooksPluginContributions } from "./plugins/ReactHooksPlugin";

// Snapshot
export { getSnapshot, hydrateSnapshot, CURRENT_SNAPSHOT_VERSION } from "./snapshot/Snapshot";

// Types
export * from "./types";
