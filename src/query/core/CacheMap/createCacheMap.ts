import type { ICacheMap, ICacheMapOptions } from "@/query/types";

import { CompareCacheMap } from "./CompareCacheMap";
import { SerializeCacheMap } from "./SerializeCacheMap";

/**
 * Factory function that selects the appropriate CacheMap implementation
 * based on keyStrategy in options.
 */
export function createCacheMap<TArgs, TEntry>(options: ICacheMapOptions<TArgs, TEntry>): ICacheMap<TArgs, TEntry> {
    return options.keyStrategy === "compare" ? new CompareCacheMap(options) : new SerializeCacheMap(options);
}
