// Machines
export {
    Machine,
    MachineError,
    MachineIdle,
    MachinePending,
    MachineRefreshing,
    MachineSuccess,
    MachineWithData,
    Patcher,
} from "./machines";
export type { IPatchResolution } from "./machines";

// CacheEntry
export { CacheEntry } from "./CacheEntry";

// CacheMap (factory only — implementations are internal)
export { createCacheMap } from "./CacheMap";

// Resource
export { ResourceV2, ResourceV2Agent, ResourceV2CacheEntry } from "./resource";

// Lifecycle
export { LifecycleHooks } from "./LifecycleHooks";

// Snapshot (hydrateSnapshot intentionally NOT exported — API-layer version is the sole public export)
export { getSnapshot } from "./Snapshot";
