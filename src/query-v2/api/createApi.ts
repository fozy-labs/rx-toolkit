import { ResourceV2, type ResourceV2Config } from "@/query-v2/core/resource/ResourceV2";
import { getSnapshot, hydrateSnapshot } from "@/query-v2/snapshot/Snapshot";
import type { IApi, ICreateApiOptions } from "@/query-v2/types/api.types";
import type { IPlugin, PluginAugmentations } from "@/query-v2/types/plugin.types";
import type { IResourceV2, IResourceV2Options } from "@/query-v2/types/resource.types";
import type { TApiSnapshot } from "@/query-v2/types/snapshot.types";

const DEFAULT_CACHE_LIFETIME = 60_000;
const DEFAULT_MAX_SNAPSHOT_DATA_AGE = 300_000; // 5 minutes

/**
 * Create a query-v2 API instance — the root entry point for managing resources, snapshots, and plugins.
 *
 * @param options - Configuration for the API instance (keyPrefix, plugins, snapshot, cache settings).
 * @returns API instance with `createResource`, `resetAll`, and `getSnapshot` methods.
 * @see docs/query-v2/README.md
 */
export function createApi<TPlugins extends IPlugin[] = []>(
    options: ICreateApiOptions<TPlugins> = {} as ICreateApiOptions<TPlugins>,
): IApi<TPlugins> {
    const {
        keyPrefix = null,
        keyStrategy = "serialize",
        serializeArgs,
        compareArg,
        initialSnapshot = null,
        cacheLifetime = DEFAULT_CACHE_LIFETIME,
        plugins = [] as unknown as TPlugins,
        maxSnapshotDataAge = DEFAULT_MAX_SNAPSHOT_DATA_AGE,
        doCacheArgs = false,
    } = options;

    // ADR-6: Generic registry (Map, not typed to resources only)
    const registry = new Map<string, ResourceV2<any, any, any>>();

    // Plugin initialization: call install() once per plugin
    const pluginContext = {
        get api() {
            return api;
        },
        keyStrategy,
    };
    for (const plugin of plugins) {
        plugin.install(pluginContext);
    }

    const api: IApi<TPlugins> = {
        createResource<TArgs, TData, TError = Error>(
            resourceOptions: IResourceV2Options<TArgs, TData, TError>,
        ): IResourceV2<TArgs, TData, TError> & PluginAugmentations<TPlugins, TArgs, TData, TError> {
            // Merge: resource options override API defaults
            const mergedConfig: ResourceV2Config<TArgs, TData, TError> = {
                key: resourceOptions.key,
                keyPrefix: keyPrefix ?? undefined,
                keyStrategy,
                queryFn: resourceOptions.queryFn,
                onCacheEntryAdded: resourceOptions.onCacheEntryAdded,
                onQueryStarted: resourceOptions.onQueryStarted,
                serializeArgs: resourceOptions.serializeArgs ?? serializeArgs,
                compareArg: resourceOptions.compareArg ?? compareArg,
                cacheLifetime: resourceOptions.cacheLifetime ?? cacheLifetime,
                beforeDevtoolsPush: resourceOptions.beforeDevtoolsPush,
                maxSnapshotDataAge: resourceOptions.maxSnapshotDataAge ?? maxSnapshotDataAge,
                doCacheArgs: resourceOptions.doCacheArgs ?? doCacheArgs,
            };

            // Validate unique key (for serialize strategy, key is expected for snapshot)
            const resourceKey = mergedConfig.key;
            if (resourceKey != null) {
                if (registry.has(resourceKey)) {
                    throw new Error(`Duplicate resource key "${resourceKey}". Each resource must have a unique key.`);
                }
            }

            // Create resource
            const resource = new ResourceV2<TArgs, TData, TError>(mergedConfig);

            // Apply plugin augmentations
            const augmentations: Record<string, unknown> = {};
            for (const plugin of plugins) {
                const pluginContributions = plugin.augmentResource(resource, resourceOptions);
                Object.assign(augmentations, pluginContributions);
            }

            // Create the augmented resource
            const augmentedResource = Object.assign(resource, augmentations) as unknown as IResourceV2<
                TArgs,
                TData,
                TError
            > &
                PluginAugmentations<TPlugins, TArgs, TData, TError>;

            // Register resource
            if (resourceKey != null) {
                registry.set(resourceKey, resource);
            }

            // Hydrate from initial snapshot if available
            if (initialSnapshot && resourceKey != null) {
                const snapshotMaxAge = mergedConfig.maxSnapshotDataAge ?? maxSnapshotDataAge;
                const singleResourceRegistry = new Map<string, ResourceV2<any, any, any>>();
                singleResourceRegistry.set(resourceKey, resource);
                hydrateSnapshot(initialSnapshot, singleResourceRegistry, keyPrefix, snapshotMaxAge);
            }

            return augmentedResource;
        },

        resetAll(): void {
            for (const [, resource] of registry) {
                resource.resetCache();
            }
        },

        getSnapshot(): TApiSnapshot {
            return getSnapshot(registry, keyPrefix, keyStrategy);
        },
    };

    return api;
}
