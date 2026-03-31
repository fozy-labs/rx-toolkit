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
export { ResourceV2, ResourceV2Agent, ResourceV2CacheEntry } from "./resource";

// Command
export { CommandV2, CommandV2Agent, CommandV2CacheEntry, ResourceV2Ref } from "./command";

// Snapshot (hydrateSnapshot intentionally NOT exported — API-layer version is the sole public export)
export { getSnapshot } from "./Snapshot";
