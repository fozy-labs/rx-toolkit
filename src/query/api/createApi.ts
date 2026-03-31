import { Command } from "@/query/core/command/Command";
import { Resource } from "@/query/core/resource/Resource";
import { getSnapshot, hydrateSnapshot } from "@/query/core/Snapshot";
import type {
    IApi,
    ICommand,
    ICreateApiOptions,
    IPlugin,
    IResource,
    PluginAugmentations,
    PluginCommandAugmentations,
    TApiSnapshot,
    TCommandOptions,
    TResourceOptions,
} from "@/query/types";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/types";

/** @internal Symbol for accessing internal resources map from hydrateSnapshot */
export const API_INTERNALS = Symbol("API_INTERNALS");

export interface IApiInternals {
    resources: Map<string, Resource<unknown, unknown>>;
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

    const _resources = new Map<string, Resource<unknown, unknown>>();
    const _commands = new Set<Command<unknown, unknown>>();

    function apiCreateResource<TArgs = void, TData = unknown>(
        resourceOptions: TResourceOptions<TArgs, TData>,
    ): IResource<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData> {
        const key = resourceOptions.key;

        if (key !== null && key !== undefined && _resources.has(key)) {
            throw new Error(`createApi: Duplicate resource key "${key}".`);
        }

        // Merge API defaults with resource options
        const mergedOptions: TResourceOptions<TArgs, TData> = {
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

        const resource = new Resource<TArgs, TData>(mergedOptions);

        if (key != null) {
            _resources.set(key, resource as unknown as Resource<unknown, unknown>);
        }

        // Hydrate from saved snapshot if available
        if (_savedSnapshot && key != null && _savedSnapshot.resources[key]) {
            const resourceSnapshot = _savedSnapshot.resources[key];

            const snapshotResources = new Map<string, Resource<TArgs, TData>>();
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
                for (const entry of resource.cacheValues()) {
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

        return resource as unknown as IResource<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>;
    }

    function resetAll(): void {
        for (const resource of _resources.values()) {
            resource.resetCache();
        }
        for (const command of _commands) {
            command.resetCache();
        }
        _savedSnapshot = null;
    }

    function apiGetSnapshot(): TApiSnapshot {
        return getSnapshot(_resources, keyPrefix);
    }

    function apiCreateCommand<TArgs = void, TResult = unknown>(
        commandOptions: TCommandOptions<TArgs, TResult>,
    ): ICommand<TArgs, TResult> & PluginCommandAugmentations<TPlugins, TArgs, TResult> {
        const mergedOptions: TCommandOptions<TArgs, TResult> = {
            cacheLifetime: 0,
            ...commandOptions,
        };

        const command = new Command<TArgs, TResult>(mergedOptions);
        _commands.add(command as unknown as Command<unknown, unknown>);

        // Plugin augmentation
        const contributedKeys = new Set<string>();
        for (const plugin of plugins) {
            if (plugin.augmentCommand) {
                const contributions = plugin.augmentCommand(command, mergedOptions);
                if (contributions) {
                    for (const contributionKey of Object.keys(contributions)) {
                        if (contributedKeys.has(contributionKey)) {
                            throw new Error(`createApi: Plugin key collision: "${contributionKey}".`);
                        }
                        contributedKeys.add(contributionKey);
                    }
                    Object.assign(command, contributions);
                }
            }
        }

        return command as unknown as ICommand<TArgs, TResult> & PluginCommandAugmentations<TPlugins, TArgs, TResult>;
    }

    return {
        createResource: apiCreateResource,
        createCommand: apiCreateCommand,
        resetAll,
        getSnapshot: apiGetSnapshot,
        [API_INTERNALS]: {
            resources: _resources,
            keyPrefix,
            maxSnapshotDataAge,
        } satisfies IApiInternals,
    } as IApi<TPlugins>;
}
