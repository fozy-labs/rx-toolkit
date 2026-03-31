// Machines
export {
    Machine,
    MachineError,
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
export { Resource, ResourceAgent, ResourceCacheEntry } from "./resource";

// Command
export { Command, CommandAgent, CommandCacheEntry, ResourceRef } from "./command";

// Snapshot (hydrateSnapshot intentionally NOT exported — API-layer version is the sole public export)
export { getSnapshot } from "./Snapshot";
