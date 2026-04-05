import type { ICacheMap, ICacheMapOptions } from "@/query/types";

import { CompareCacheMap } from "./CompareCacheMap";
import { SerializeCacheMap } from "./SerializeCacheMap";

/**
 * Factory function that selects the appropriate CacheMap implementation
 * based on strategy in options.
 */
export function createCacheMap<TArgs, TEntry>(options: ICacheMapOptions<TArgs, TEntry>): ICacheMap<TArgs, TEntry> {
    return options.strategy === "compare" ? new CompareCacheMap(options) : new SerializeCacheMap(options);
}
