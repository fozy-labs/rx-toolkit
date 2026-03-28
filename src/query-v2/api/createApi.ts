import { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import { getSnapshot, hydrateSnapshot } from "@/query-v2/core/Snapshot";
import type {
    IApi,
    ICreateApiOptions,
    IPlugin,
    IResourceV2,
    TResourceV2Options,
    PluginAugmentations,
    TApiSnapshot,
} from "@/query-v2/types";
import { CURRENT_SNAPSHOT_VERSION } from "@/query-v2/types";

/** @internal Symbol for accessing internal resources map from hydrateSnapshot */
export const API_INTERNALS = Symbol("API_INTERNALS");

export interface IApiInternals {
    resources: Map<string, ResourceV2<unknown, unknown>>;
    keyPrefix: string | null;
    maxSnapshotDataAge: number | undefined;
}

export function createApi<TPlugins extends readonly IPlugin[] = readonly IPlugin[]>(
    options?: ICreateApiOptions<TPlugins>,
): IApi<TPlugins> {
    const opts = options ?? ({} as ICreateApiOptions<TPlugins>);
    const keyPrefix = opts.keyPrefix ?? null;
    const keyStrategy = opts.keyStrategy ?? "serialize";
    const serializeArgs = opts.serializeArgs;
    const compareArg = opts.compareArg;
    const cacheLifetime = opts.cacheLifetime ?? 60_000;
    const plugins = (opts.plugins ?? []) as unknown as TPlugins;
    const initialSnapshot = opts.initialSnapshot ?? null;
    const maxSnapshotDataAge = opts.maxSnapshotDataAge;
    const doCacheArgs = opts.doCacheArgs;

    // Validate initialSnapshot at save time
    let _savedSnapshot: TApiSnapshot | null = null;
    if (initialSnapshot) {
        if (initialSnapshot.version !== CURRENT_SNAPSHOT_VERSION) {
            throw new Error(
                `createApi: Snapshot version mismatch. Expected ${CURRENT_SNAPSHOT_VERSION}, got ${initialSnapshot.version}.`,
            );
        }
        if (initialSnapshot.keyPrefix !== keyPrefix) {
            throw new Error(
                `createApi: Snapshot keyPrefix mismatch. Expected "${keyPrefix}", got "${initialSnapshot.keyPrefix}".`,
            );
        }
        // Deep clone the resources record so we can delete consumed slices
        _savedSnapshot = {
            ...initialSnapshot,
            resources: { ...initialSnapshot.resources },
        };
    }

    // Install plugins
    const pluginContext = { keyStrategy };
    for (const plugin of plugins) {
        plugin.install(pluginContext);
    }

    const _resources = new Map<string, ResourceV2<unknown, unknown>>();

    function apiCreateResourceV2<TArgs, TData>(
        resourceOptions: TResourceV2Options<TArgs, TData>,
    ): IResourceV2<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData> {
        const key = resourceOptions.key;

        if (key !== null && key !== undefined && _resources.has(key)) {
            throw new Error(`createApi: Duplicate resource key "${key}".`);
        }

        // Merge API defaults with resource options
        const mergedOptions: TResourceV2Options<TArgs, TData> = {
            cacheLifetime,
            doCacheArgs,
            ...resourceOptions,
            // API-level serializeArgs / compareArg as default, resource can override
            ...(keyStrategy === "compare" && compareArg && !resourceOptions.compareArg
                ? { compareArg: compareArg as unknown as typeof resourceOptions.compareArg }
                : {}),
            ...(keyStrategy === "serialize" && serializeArgs && !resourceOptions.serializeArgs
                ? { serializeArgs: serializeArgs as unknown as typeof resourceOptions.serializeArgs }
                : {}),
        };

        const resource = new ResourceV2<TArgs, TData>(mergedOptions);

        if (key != null) {
            _resources.set(key, resource as unknown as ResourceV2<unknown, unknown>);
        }

        // Hydrate from saved snapshot if available
        if (_savedSnapshot && key != null && _savedSnapshot.resources[key]) {
            const resourceSnapshot = _savedSnapshot.resources[key];

            const snapshotResources = new Map<string, ResourceV2<TArgs, TData>>();
            snapshotResources.set(key, resource);
            const sliceSnapshot: TApiSnapshot = {
                version: _savedSnapshot.version,
                keyPrefix: _savedSnapshot.keyPrefix,
                timestamp: _savedSnapshot.timestamp,
                resources: { [key]: resourceSnapshot },
            };
            hydrateSnapshot(snapshotResources, sliceSnapshot);

            // Auto-invalidate stale entries
            const effectiveMaxAge = resourceOptions.maxSnapshotDataAge ?? maxSnapshotDataAge;
            if (effectiveMaxAge != null) {
                const now = Date.now();
                for (const [, entry] of resource.cacheEntries()) {
                    const machine = entry.peek();
                    if (machine.status === "success" && now - machine.updatedAt > effectiveMaxAge) {
                        entry.invalidate();
                    }
                }
            }

            // Consume the slice
            delete (_savedSnapshot.resources as Record<string, unknown>)[key];
        }

        // Plugin augmentation — applied incrementally so later plugins see earlier contributions
        const contributedKeys = new Set<string>();
        for (const plugin of plugins) {
            if (plugin.augmentResource) {
                const contributions = plugin.augmentResource(resource, mergedOptions);
                if (contributions) {
                    for (const contributionKey of Object.keys(contributions)) {
                        if (contributedKeys.has(contributionKey)) {
                            throw new Error(`createApi: Plugin key collision: "${contributionKey}".`);
                        }
                        contributedKeys.add(contributionKey);
                    }
                    Object.assign(resource, contributions);
                }
            }
        }

        return resource as unknown as IResourceV2<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>;
    }

    function resetAll(): void {
        for (const resource of _resources.values()) {
            resource.resetCache();
        }
        _savedSnapshot = null;
    }

    function apiGetSnapshot(): TApiSnapshot {
        return getSnapshot(_resources, keyPrefix);
    }

    return {
        createResourceV2: apiCreateResourceV2,
        resetAll,
        getSnapshot: apiGetSnapshot,
        [API_INTERNALS]: {
            resources: _resources,
            keyPrefix,
            maxSnapshotDataAge,
        } satisfies IApiInternals,
    } as IApi<TPlugins>;
}
