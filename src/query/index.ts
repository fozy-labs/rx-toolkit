export * from "./api";
export * from "./constants";
export * from "./lib";
export * from "./react";
export * from "./types";
// Public so consumers can branch on it inside `mapError` (a command entry
// evicted mid-flight surfaces this error through the typed envelope).
// BatchItemMissingError likewise reaches consumers through a batch entry's
// error state when a batch response does not cover every requested id.
// EmptyStreamError reaches consumers through an entry's error state when a
// stream-returning queryFn completes without emitting.
export { BatchItemMissingError, CacheEntryRemovedError, EmptyStreamError } from "./core/errors";
// Public utility to stack several lifecycle hooks (onQueryStarted /
// onCacheEntryAdded) into a single option value.
export { composeHooks } from "./core/api";
export {
    Machine,
    MachineBase,
    MachineWithData,
    MachinePending,
    MachineSuccess,
    MachineError,
    MachineRefreshing,
    MachineRefreshError,
} from "./core/machine";
