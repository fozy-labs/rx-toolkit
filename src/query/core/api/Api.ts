import { stableStringify } from "@/query/lib/stableStringify";
import type {
    IApi,
    ICommand,
    ICommandConfig,
    IResource,
    IResourceConfig,
    TApiSnapshot,
    TCommandOptions,
    TCreateApiOptions,
    TMapError,
    TResourceOptions,
} from "@/query/types";

import { Command } from "../command/Command";
import { Resource } from "../resource/Resource";
import { Snapshoter } from "../snapshoter";
import { Syncer } from "../syncer";

import { DEFAULT_COMMAND_RETENTION_TIME, DEFAULT_RESOURCE_RETENTION_TIME } from "./constants";
import { mergeHooks } from "./mergeHooks";
import { normalizeLinks } from "./normalizeLinks";

/**
 * Wrap the consumer's `mapError` into an always-safe normalizer.
 *
 * - No consumer mapper → identity (`TError` stays `unknown`, behavior unchanged).
 * - A throwing mapper must never break the state machine: the throw is logged and
 *   the original (raw) error is used instead, so a failure state is always reached.
 */
function composeMapError(userMapError: TMapError | undefined): TMapError {
    if (!userMapError) {
        return (error) => error;
    }

    return (error, ctx) => {
        try {
            return userMapError(error, ctx);
        } catch (mapErrorFailure) {
            console.error(
                "[rx-toolkit] mapError threw while normalizing an error; falling back to the original error.",
                mapErrorFailure,
            );
            return error;
        }
    };
}

export class Api implements IApi {
    private readonly resources: Resource<any, any>[] = [];
    private readonly commands: Command<any, any>[] = [];
    private readonly resourcesByKey = new Map<string, Resource<any, any>>();

    private readonly keyPrefix: string | null;
    private readonly plugins: NonNullable<TCreateApiOptions["plugins"]>;
    private readonly apiSerializeArgs: (args: any) => string;
    private readonly apiResourceRetentionTime: number | false;
    private readonly apiCommandRetentionTime: number | false;
    private readonly snapshoter: Snapshoter;
    private readonly apiOnCacheEntryAdded: TCreateApiOptions["onCacheEntryAdded"];
    private readonly apiOnQueryStarted: TCreateApiOptions["onQueryStarted"];
    private readonly apiMapError: TMapError;
    private readonly syncer: Syncer | null;

    constructor(options?: TCreateApiOptions) {
        this.keyPrefix = options?.keyPrefix ?? null;
        this.plugins = options?.plugins ?? [];
        this.apiSerializeArgs = options?.serializeArgs ?? stableStringify;
        this.apiResourceRetentionTime = options?.resourceRetentionTime ?? DEFAULT_RESOURCE_RETENTION_TIME;
        this.apiCommandRetentionTime = options?.commandRetentionTime ?? DEFAULT_COMMAND_RETENTION_TIME;
        this.snapshoter = new Snapshoter({
            initialSnapshot: options?.initialSnapshot ?? null,
            snapshotValidTime: options?.snapshotValidTime ?? false,
            keyPrefix: this.keyPrefix,
        });
        this.apiOnCacheEntryAdded = options?.onCacheEntryAdded;
        this.apiOnQueryStarted = options?.onQueryStarted;
        this.apiMapError = composeMapError(options?.mapError);

        const syncDriver = options?.syncDriver;
        const defaultSync = options?.defaultSync ?? "none";

        this.syncer = syncDriver
            ? new Syncer({ syncDriver, keyPrefix: this.keyPrefix, defaultSync, resourcesByKey: this.resourcesByKey })
            : null;

        // Install plugins
        for (const plugin of this.plugins) {
            plugin.install({ keyPrefix: this.keyPrefix ?? "" });
        }

        // Connect sync driver after setup
        this.syncer?.connect();
    }

    createResource = <TArgs = void, TData = unknown>(opts: TResourceOptions<TArgs, TData>): IResource<TArgs, TData> => {
        const effectiveRetentionTime =
            opts.retentionTime !== undefined ? opts.retentionTime : this.apiResourceRetentionTime;

        const effectiveSerializeArgs = opts.serializeArgs ?? (this.apiSerializeArgs as (args: TArgs) => string);

        const effectiveKey = this.keyPrefix != null && opts.key != null ? `${this.keyPrefix}/${opts.key}` : opts.key;

        // Merge lifecycle hooks: API-level + resource-level
        const mergedOnCacheEntryAdded = mergeHooks(this.apiOnCacheEntryAdded, opts.onCacheEntryAdded);
        const mergedOnQueryStarted = mergeHooks(this.apiOnQueryStarted, opts.onQueryStarted);

        // Snapshot hydration: build initialEntries if snapshot has matching resource data
        const initialEntries = this.snapshoter.hydrateResource(opts.key, opts.snapshotValidTime);

        const syncEnabled = this.syncer && this.syncer.isResourceSyncEnabled(opts);

        const config: IResourceConfig<TArgs, TData> = {
            queryFn: opts.queryFn,
            key: effectiveKey,
            retentionTime: effectiveRetentionTime,
            serializeArgs: effectiveSerializeArgs,
            mapError: this.apiMapError,
            onCacheEntryAdded: mergedOnCacheEntryAdded,
            onQueryStarted: mergedOnQueryStarted,
            snapshot: initialEntries,
            beforeQuery: syncEnabled
                ? (this.syncer!.beforeQuery as IResourceConfig<TArgs, TData>["beforeQuery"])
                : undefined,
        };

        const resource = new Resource<TArgs, TData>(config);

        // Track for resetAll / getSnapshot
        this.resources.push(resource);

        if (effectiveKey) {
            this.resourcesByKey.set(effectiveKey, resource);
        }

        // Plugin augmentation
        let augmented: Record<string, unknown> = {};
        for (const plugin of this.plugins) {
            if (plugin.augmentResource) {
                const additions = plugin.augmentResource(resource, opts);
                augmented = { ...augmented, ...additions };
            }
        }

        // Spread augmented properties onto the resource object
        Object.assign(resource, augmented);

        return resource;
    };

    createCommand = <TArgs = void, TData = unknown>(opts: TCommandOptions<TArgs, TData>): ICommand<TArgs, TData> => {
        const effectiveRetentionTime =
            opts.retentionTime !== undefined ? opts.retentionTime : this.apiCommandRetentionTime;

        const effectiveKey = this.keyPrefix != null && opts.key != null ? `${this.keyPrefix}/${opts.key}` : opts.key;

        // Merge lifecycle hooks: API-level + command-level
        const mergedOnCacheEntryAdded = mergeHooks(this.apiOnCacheEntryAdded, opts.onCacheEntryAdded);
        const mergedOnQueryStarted = mergeHooks(this.apiOnQueryStarted, opts.onQueryStarted);

        const config: ICommandConfig<TArgs, TData> = {
            queryFn: opts.queryFn,
            generateRequestId: opts.generateRequestId,
            key: effectiveKey,
            mapError: this.apiMapError,
            links: normalizeLinks(opts.links),
            retentionTime: effectiveRetentionTime,
            onCacheEntryAdded: mergedOnCacheEntryAdded,
            onQueryStarted: mergedOnQueryStarted,
        };

        const command = new Command<TArgs, TData>(config);

        // Track for resetAll
        this.commands.push(command);

        // Plugin augmentation
        let augmented: Record<string, unknown> = {};
        for (const plugin of this.plugins) {
            if (plugin.augmentCommand) {
                const additions = plugin.augmentCommand(command, opts);
                augmented = { ...augmented, ...additions };
            }
        }

        Object.assign(command, augmented);

        return command;
    };

    getSnapshot = (): TApiSnapshot => {
        return this.snapshoter.getSnapshot(this.resources);
    };

    resetAll = (): void => {
        for (const resource of this.resources) {
            resource.reset();
        }
        for (const command of this.commands) {
            command.reset();
        }

        // Clean up sync state and reconnect
        this.syncer?.cleanup();
    };
}
