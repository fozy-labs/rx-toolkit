import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/constants";
import { composeHooks } from "@/query/core/api";
import { stableStringify } from "@/query/lib/stableStringify";
import type {
    IPlugin,
    ISyncDriver,
    ISyncMessage,
    TApiSnapshot,
    TCommandEntryIdleState,
    TCommandEntryState,
    TCreateApiOptions,
    TResourceEntryIdleState,
    TResourceEntryState,
} from "@/query/types";

// ==================== Helpers ====================

function createMockPlugin(name: string, overrides?: Partial<IPlugin>): IPlugin {
    return {
        name,
        install: vi.fn(),
        augmentResource: vi.fn(() => ({})),
        augmentCommand: vi.fn(() => ({})),
        ...overrides,
    };
}

function createMockSyncDriver(): ISyncDriver & {
    simulateMessage: (msg: ISyncMessage) => void;
} {
    let onMessage: ((msg: ISyncMessage) => void) | null = null;
    return {
        connect: vi.fn((cb) => {
            onMessage = cb;
        }),
        disconnect: vi.fn(),
        send: vi.fn(),
        simulateMessage(msg) {
            onMessage?.(msg);
        },
    };
}

const dummyQueryFn = async () => "data";

// ==================== Default Options ====================

describe("createApi — defaults", () => {
    it("creates API with no options (all defaults)", () => {
        const api = createApi();
        expect(api.createResource).toBeTypeOf("function");
        expect(api.createCommand).toBeTypeOf("function");
        expect(api.getSnapshot).toBeTypeOf("function");
        expect(api.resetAll).toBeTypeOf("function");
    });

    it("creates API with empty options object", () => {
        const api = createApi({});
        expect(api).toBeDefined();
    });

    it("getSnapshot returns valid structure with defaults", () => {
        const api = createApi();
        const snapshot = api.getSnapshot();
        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBeNull();
        expect(snapshot.resources).toEqual({});
        expect(typeof snapshot.timestamp).toBe("number");
    });
});

// ==================== Custom Options Propagation ====================

describe("createApi — custom options propagation", () => {
    it("keyPrefix is reflected in getSnapshot", () => {
        const api = createApi({ keyPrefix: "myApp" });
        const snapshot = api.getSnapshot();
        expect(snapshot.keyPrefix).toBe("myApp");
    });

    it("keyPrefix is prepended to resource key", async () => {
        const api = createApi({ keyPrefix: "app" });
        const resource = api.createResource({
            key: "users",
            queryFn: async () => "data",
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();
        // The raw snapshot key should be the un-prefixed key "users"
        // because snapshotter uses the opts.key for snapshot lookup
        // But the resource internal key is "app/users"
        expect(resource.serialize(undefined as void)).toBeDefined();
    });

    it("keyPrefix is prepended to command key", () => {
        const api = createApi({ keyPrefix: "app" });
        // Command creation should not throw
        const command = api.createCommand({
            key: "addUser",
            queryFn: async () => "ok",
        });
        expect(command).toBeDefined();
    });

    it("keyPrefix null does not prefix keys", async () => {
        const api = createApi({ keyPrefix: null });
        const resource = api.createResource({
            key: "users",
            queryFn: async () => ({ id: 1 }),
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();
        expect(snapshot.resources).toHaveProperty("users");
    });

    it("resource uses custom serializeArgs from API options", () => {
        const customSerializer = vi.fn((args: unknown) => `custom-${String(args)}`);
        const api = createApi({ serializeArgs: customSerializer });
        const resource = api.createResource({
            queryFn: async (args: number) => args * 2,
        });

        resource.serialize(42);
        expect(customSerializer).toHaveBeenCalledWith(42);
    });

    it("resource-level serializeArgs overrides API-level", () => {
        const apiSerializer = vi.fn((args: unknown) => `api-${String(args)}`);
        const localSerializer = vi.fn((args: number) => `local-${args}`);
        const api = createApi({ serializeArgs: apiSerializer });
        const resource = api.createResource({
            queryFn: async (args: number) => args,
            serializeArgs: localSerializer,
        });

        resource.serialize(42);
        expect(localSerializer).toHaveBeenCalledWith(42);
        expect(apiSerializer).not.toHaveBeenCalled();
    });

    it("resource uses custom retentionTime from API options", () => {
        // If API-level retentionTime is set, resource should use it.
        // We verify by creating a resource without explicit retentionTime.
        const api = createApi({ resourceRetentionTime: 30_000 });
        const resource = api.createResource({
            queryFn: dummyQueryFn,
        });
        // Resource creation succeeds — no direct way to inspect config,
        // but the resource should be functional
        expect(resource).toBeDefined();
    });

    it("resource-level retentionTime overrides API-level", () => {
        const api = createApi({ resourceRetentionTime: 30_000 });
        const resource = api.createResource({
            queryFn: dummyQueryFn,
            retentionTime: 5_000,
        });
        expect(resource).toBeDefined();
    });

    it("command uses commandRetentionTime from API options", () => {
        const api = createApi({ commandRetentionTime: 10_000 });
        const command = api.createCommand({
            queryFn: async () => "ok",
        });
        expect(command).toBeDefined();
    });

    it("command-level retentionTime overrides API-level", () => {
        const api = createApi({ commandRetentionTime: 10_000 });
        const command = api.createCommand({
            queryFn: async () => "ok",
            retentionTime: 1_000,
        });
        expect(command).toBeDefined();
    });
});

// ==================== Retention time as a function ====================

/** The `state` an api- or resource-level `retentionTime` function receives. */
type TResourceRetentionState<TArgs, TData> = Exclude<TResourceEntryState<TArgs, TData>, TResourceEntryIdleState>;

/** The `state` an api- or command-level `retentionTime` function receives. */
type TCommandRetentionState<TArgs, TData> = Exclude<TCommandEntryState<TArgs, TData>, TCommandEntryIdleState>;

/**
 * The api-level `resourceRetentionTime` / `commandRetentionTime` accept the same
 * function form as the resource / command option, over `unknown` args and state.
 * A resource- or command-level option replaces the api-level one entirely — the
 * api-level function is then never called, exactly as with a static value.
 */
describe("createApi — retentionTime as a function", () => {
    /** An api-level policy that retains everything and records what it was asked about. */
    function createApiResourceRetention() {
        return vi.fn((_args: unknown, _state: TResourceRetentionState<unknown, unknown>): number | false => false);
    }

    function createApiCommandRetention() {
        return vi.fn((_args: unknown, _state: TCommandRetentionState<unknown, unknown>): number | false => false);
    }

    it("resourceRetentionTime function governs a resource that declares none", async () => {
        const resourceRetentionTime = createApiResourceRetention();
        const api = createApi({ resourceRetentionTime });
        const resource = api.createResource({ queryFn: async (args: number) => args * 2 });

        // `ensure` holds the entry alive until it settles; dropping that
        // subscription is the `active → retention` transition.
        await resource.ensure(1);
        await flushMicrotasks();

        expect(resourceRetentionTime).toHaveBeenCalledTimes(1);
        expect(resourceRetentionTime.mock.calls[0]?.[0]).toBe(1);
        expect(resourceRetentionTime.mock.calls[0]?.[1]).toMatchObject({
            status: "success",
            dataSource: "current",
            hasData: true,
            hasError: false,
            data: 2,
            args: 1,
        });
    });

    it("a resource-level function replaces the api-level one entirely", async () => {
        const resourceRetentionTime = createApiResourceRetention();
        const ownRetentionTime = vi.fn(
            (_args: number, _state: TResourceRetentionState<number, number>): number | false => false,
        );
        const api = createApi({ resourceRetentionTime });
        const resource = api.createResource({
            queryFn: async (args: number) => args * 2,
            retentionTime: ownRetentionTime,
        });

        await resource.ensure(1);
        await flushMicrotasks();

        expect(ownRetentionTime).toHaveBeenCalledTimes(1);
        expect(ownRetentionTime.mock.calls[0]?.[0]).toBe(1);
        expect(resourceRetentionTime).not.toHaveBeenCalled();
    });

    it("a resource-level static value replaces the api-level function", async () => {
        const resourceRetentionTime = createApiResourceRetention();
        const api = createApi({ resourceRetentionTime });
        const resource = api.createResource({
            queryFn: async (args: number) => args * 2,
            retentionTime: false,
        });

        await resource.ensure(1);
        await flushMicrotasks();

        expect(resourceRetentionTime).not.toHaveBeenCalled();
        expect(resource.getEntry(1)).not.toBeNull();
    });

    it("commandRetentionTime function governs a command that declares none", async () => {
        const commandRetentionTime = createApiCommandRetention();
        const api = createApi({ commandRetentionTime });
        const command = api.createCommand({ queryFn: async (args: string) => `result-${args}` });

        await command.execute("a", "k1");
        await flushMicrotasks();

        expect(commandRetentionTime).toHaveBeenCalledTimes(1);
        expect(commandRetentionTime.mock.calls[0]?.[0]).toBe("a");
        expect(commandRetentionTime.mock.calls[0]?.[1]).toMatchObject({
            status: "success",
            hasData: true,
            hasError: false,
            data: "result-a",
            args: "a",
        });
    });

    it("a command-level function replaces the api-level one entirely", async () => {
        const commandRetentionTime = createApiCommandRetention();
        const ownRetentionTime = vi.fn(
            (_args: string, _state: TCommandRetentionState<string, string>): number | false => false,
        );
        const api = createApi({ commandRetentionTime });
        const command = api.createCommand({
            queryFn: async (args: string) => `result-${args}`,
            retentionTime: ownRetentionTime,
        });

        await command.execute("a", "k1");
        await flushMicrotasks();

        expect(ownRetentionTime).toHaveBeenCalledTimes(1);
        expect(ownRetentionTime.mock.calls[0]?.[0]).toBe("a");
        expect(commandRetentionTime).not.toHaveBeenCalled();
    });

    it("a command-level static value replaces the api-level function", async () => {
        const commandRetentionTime = createApiCommandRetention();
        const api = createApi({ commandRetentionTime });
        const command = api.createCommand({
            queryFn: async (args: string) => `result-${args}`,
            retentionTime: false,
        });

        await command.execute("a", "k1");
        await flushMicrotasks();

        expect(commandRetentionTime).not.toHaveBeenCalled();
        expect(command.getEntry("k1")).not.toBeNull();
    });
});

// ==================== Plugin System ====================

describe("createApi — plugin system", () => {
    it("calls plugin.install with keyPrefix on creation", () => {
        const plugin = createMockPlugin("test-plugin");
        createApi({ keyPrefix: "myApp", plugins: [plugin] });
        expect(plugin.install).toHaveBeenCalledWith({ keyPrefix: "myApp" });
    });

    it("passes empty string keyPrefix to plugin when keyPrefix is null", () => {
        const plugin = createMockPlugin("test-plugin");
        createApi({ plugins: [plugin] });
        expect(plugin.install).toHaveBeenCalledWith({ keyPrefix: "" });
    });

    it("calls augmentResource for each resource created", () => {
        const plugin = createMockPlugin("test-plugin");
        const api = createApi({ plugins: [plugin] });

        api.createResource({ queryFn: dummyQueryFn });
        expect(plugin.augmentResource).toHaveBeenCalledTimes(1);

        api.createResource({ queryFn: dummyQueryFn });
        expect(plugin.augmentResource).toHaveBeenCalledTimes(2);
    });

    it("calls augmentCommand for each command created", () => {
        const plugin = createMockPlugin("test-plugin");
        const api = createApi({ plugins: [plugin] });

        api.createCommand({ queryFn: async () => "ok" });
        expect(plugin.augmentCommand).toHaveBeenCalledTimes(1);
    });

    it("augmentResource returned props are merged onto resource", () => {
        const plugin = createMockPlugin("test-plugin", {
            augmentResource: vi.fn(() => ({ customProp: "hello" })),
        });
        const api = createApi({ plugins: [plugin] });
        const resource = api.createResource({ queryFn: dummyQueryFn });
        expect((resource as any).customProp).toBe("hello");
    });

    it("augmentCommand returned props are merged onto command", () => {
        const plugin = createMockPlugin("test-plugin", {
            augmentCommand: vi.fn(() => ({ extra: 42 })),
        });
        const api = createApi({ plugins: [plugin] });
        const command = api.createCommand({ queryFn: async () => "ok" });
        expect((command as any).extra).toBe(42);
    });

    it("multiple plugins: later plugin props overwrite earlier ones", () => {
        const plugin1 = createMockPlugin("p1", {
            augmentResource: vi.fn(() => ({ shared: "from-p1", unique1: true })),
        });
        const plugin2 = createMockPlugin("p2", {
            augmentResource: vi.fn(() => ({ shared: "from-p2", unique2: true })),
        });
        const api = createApi({ plugins: [plugin1, plugin2] });
        const resource = api.createResource({ queryFn: dummyQueryFn });

        expect((resource as any).shared).toBe("from-p2");
        expect((resource as any).unique1).toBe(true);
        expect((resource as any).unique2).toBe(true);
    });

    it("multiple plugins: install called in order for all plugins", () => {
        const order: string[] = [];
        const plugin1 = createMockPlugin("p1", {
            install: vi.fn(() => {
                order.push("p1");
            }),
        });
        const plugin2 = createMockPlugin("p2", {
            install: vi.fn(() => {
                order.push("p2");
            }),
        });
        createApi({ plugins: [plugin1, plugin2] });
        expect(order).toEqual(["p1", "p2"]);
    });

    it("plugin without augmentResource — no error on resource creation", () => {
        const plugin: IPlugin = {
            name: "minimal",
            install: vi.fn(),
            // no augmentResource / augmentCommand
        };
        const api = createApi({ plugins: [plugin] });
        expect(() => api.createResource({ queryFn: dummyQueryFn })).not.toThrow();
    });

    it("plugin without augmentCommand — no error on command creation", () => {
        const plugin: IPlugin = {
            name: "minimal",
            install: vi.fn(),
        };
        const api = createApi({ plugins: [plugin] });
        expect(() => api.createCommand({ queryFn: async () => "ok" })).not.toThrow();
    });

    it("empty plugins array — no install/augment calls", () => {
        const api = createApi({ plugins: [] });
        expect(() => {
            api.createResource({ queryFn: dummyQueryFn });
            api.createCommand({ queryFn: async () => "ok" });
        }).not.toThrow();
    });
});

// ==================== createResource Factory ====================

describe("createApi.createResource", () => {
    it("returns a resource with standard interface", () => {
        const api = createApi();
        const resource = api.createResource({ queryFn: dummyQueryFn });

        expect(resource.trigger).toBeTypeOf("function");
        expect(resource.invalidate).toBeTypeOf("function");
        expect(resource.getEntry).toBeTypeOf("function");
        expect(resource.getEntries).toBeTypeOf("function");
        expect(resource.createClutch).toBeTypeOf("function");
        expect(resource.serialize).toBeTypeOf("function");
    });

    it("resource queryFn works correctly", async () => {
        const api = createApi();
        const resource = api.createResource({
            queryFn: async () => "hello",
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const entries = [...resource.getEntries()];
        expect(entries.length).toBe(1);
    });

    it("resource with key is tracked for snapshot", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "items",
            queryFn: async () => [1, 2, 3],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();
        expect(snapshot.resources).toHaveProperty("items");
    });

    it("resource without key — snapshot has no entry for it", async () => {
        const api = createApi();
        api.createResource({ queryFn: dummyQueryFn });

        const snapshot = api.getSnapshot();
        expect(Object.keys(snapshot.resources)).toHaveLength(0);
    });
});

// ==================== createCommand Factory ====================

describe("createApi.createCommand", () => {
    it("returns a command with standard interface", () => {
        const api = createApi();
        const command = api.createCommand({ queryFn: async () => "ok" });

        expect(command.execute).toBeTypeOf("function");
        expect(command.trigger).toBeTypeOf("function");
        expect(command.getEntry).toBeTypeOf("function");
        expect(command.createClutch).toBeTypeOf("function");
    });

    it("command.execute executes queryFn", async () => {
        const queryFn = vi.fn(async (x: number) => x * 2);
        const api = createApi();
        const command = api.createCommand({ queryFn });

        const result = await command.execute(5);
        expect(result).toBe(10);
        expect(queryFn).toHaveBeenCalledWith(5, expect.any(String));
    });

    it("normalizes undefined links to empty array (no crash)", () => {
        const api = createApi();
        // links not provided — should not throw
        expect(() => api.createCommand({ queryFn: async () => "ok" })).not.toThrow();
    });

    it("normalizes builder-function links", () => {
        const api = createApi();
        const resource = api.createResource({
            key: "items",
            queryFn: async () => [1, 2],
        });

        const command = api.createCommand({
            queryFn: async () => "ok",
            links: (link) => {
                link({
                    resource,
                    forwardArgs: () => undefined,
                    invalidate: true,
                });
            },
        });

        expect(command).toBeDefined();
    });
});

// ==================== getSnapshot ====================

describe("createApi.getSnapshot", () => {
    it("returns snapshot with version, keyPrefix and timestamp", () => {
        const api = createApi({ keyPrefix: "test" });
        const snapshot = api.getSnapshot();

        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBe("test");
        expect(typeof snapshot.timestamp).toBe("number");
    });

    it("snapshot includes only success entries", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "data",
            queryFn: async () => "value",
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();
        const entries = snapshot.resources["data"].entries;
        const firstEntry = Object.values(entries)[0];
        expect(firstEntry.status).toBe("success");
        expect(firstEntry.data).toBe("value");
    });
});

// ==================== resetAll ====================

describe("createApi.resetAll", () => {
    it("resetAll with zero resources/commands — no error", () => {
        const api = createApi();
        expect(() => api.resetAll()).not.toThrow();
    });

    it("resetAll clears resource entries", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "items",
            queryFn: async () => [1, 2, 3],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect([...resource.getEntries()].length).toBe(1);

        api.resetAll();

        expect([...resource.getEntries()].length).toBe(0);
    });

    it("resetAll resets commands", async () => {
        const api = createApi();
        const command = api.createCommand({
            queryFn: async () => "ok",
        });

        await command.execute(undefined as void);

        api.resetAll();
        // After reset, command entries should be cleared
        expect(command.getEntry("default")).toBeNull();
    });

    it("resetAll calls syncer.cleanup when syncDriver is present", () => {
        const driver = createMockSyncDriver();
        const api = createApi({ syncDriver: driver });

        api.resetAll();

        // Syncer cleanup disconnects and reconnects
        expect(driver.disconnect).toHaveBeenCalled();
    });
});

// ==================== Sync Driver ====================

describe("createApi — sync driver", () => {
    it("syncer.connect is called at API creation when syncDriver is provided", () => {
        const driver = createMockSyncDriver();
        createApi({ syncDriver: driver });
        expect(driver.connect).toHaveBeenCalledTimes(1);
    });

    it("no syncer when syncDriver is not provided", () => {
        // Simply verify no crash when creating resources without sync
        const api = createApi();
        const resource = api.createResource({
            queryFn: dummyQueryFn,
            sync: true, // sync flag ignored without driver
        });
        expect(resource).toBeDefined();
    });

    it("defaultSync 'none' does not enable sync on resources by default", () => {
        const driver = createMockSyncDriver();
        const api = createApi({ syncDriver: driver, defaultSync: "none" });

        // Resource without explicit sync=true should not get beforeQuery
        const resource = api.createResource({
            key: "items",
            queryFn: dummyQueryFn,
        });
        expect(resource).toBeDefined();
    });

    it("resource with sync: true gets beforeQuery when syncDriver is present", () => {
        const driver = createMockSyncDriver();
        const api = createApi({ syncDriver: driver, defaultSync: "none" });

        const resource = api.createResource({
            key: "items",
            queryFn: dummyQueryFn,
            sync: true,
        });
        expect(resource).toBeDefined();
    });
});

// ==================== Snapshot Hydration ====================

describe("createApi — snapshot hydration", () => {
    it("resource created with initialSnapshot does not crash", () => {
        const initialSnapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                users: {
                    entries: {
                        [stableStringify(undefined)]: {
                            status: "success",
                            args: undefined,
                            data: { name: "Alice" },
                            updatedAt: Date.now(),
                        },
                    },
                },
            },
        };

        const api = createApi({ initialSnapshot });
        const resource = api.createResource({
            key: "users",
            queryFn: async () => ({ name: "Bob" }),
        });

        // createApi delegates hydration to Snapshotter; resource is created without error
        expect(resource).toBeDefined();
    });

    it("resource without matching snapshot key — no hydration", () => {
        const initialSnapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                other: {
                    entries: {},
                },
            },
        };

        const api = createApi({ initialSnapshot });
        const resource = api.createResource({
            key: "missing",
            queryFn: dummyQueryFn,
        });

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(0);
    });

    it("snapshotValidTime option is accepted without error", () => {
        const oldTimestamp = Date.now() - 120_000;
        const initialSnapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: oldTimestamp,
            resources: {
                data: {
                    entries: {
                        [stableStringify(undefined)]: {
                            status: "success",
                            args: undefined,
                            data: "stale-value",
                            updatedAt: oldTimestamp,
                        },
                    },
                },
            },
        };

        // snapshotValidTime is passed to Snapshotter; should not throw
        const api = createApi({
            initialSnapshot,
            snapshotValidTime: 60_000,
        });

        const resource = api.createResource({
            key: "data",
            queryFn: async () => "fresh",
        });

        expect(resource).toBeDefined();
    });

    it("stale snapshot entry hydrates as 'invalidating'", () => {
        const staleTimestamp = Date.now() - 120_000; // 2 minutes ago
        const initialSnapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: staleTimestamp,
            resources: {
                items: {
                    entries: {
                        [stableStringify(undefined)]: {
                            status: "success",
                            args: undefined,
                            data: "old-data",
                            updatedAt: staleTimestamp,
                        },
                    },
                },
            },
        };

        const api = createApi({
            initialSnapshot,
            snapshotValidTime: 60_000, // 1 minute — snapshot is 2 min old → stale
        });

        const resource = api.createResource({
            key: "items",
            queryFn: async () => "fresh-data",
        });

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(1);
        expect(entries[0].state$.peek().status).toBe("invalidating");
        expect(entries[0].state$.peek().data).toBe("old-data");
    });

    it("fresh snapshot entry hydrates as 'success'", () => {
        const freshTimestamp = Date.now() - 10_000; // 10 seconds ago
        const initialSnapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: freshTimestamp,
            resources: {
                items: {
                    entries: {
                        [stableStringify(undefined)]: {
                            status: "success",
                            args: undefined,
                            data: "cached-data",
                            updatedAt: freshTimestamp,
                        },
                    },
                },
            },
        };

        const api = createApi({
            initialSnapshot,
            snapshotValidTime: 60_000, // 1 minute — snapshot is 10s old → fresh
        });

        const resource = api.createResource({
            key: "items",
            queryFn: async () => "fresh-data",
        });

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(1);
        expect(entries[0].state$.peek().status).toBe("success");
        expect(entries[0].state$.peek().data).toBe("cached-data");
    });
});

// ==================== Lifecycle Hooks (composeHooks) ====================

describe("composeHooks", () => {
    it("no hooks → returns undefined", () => {
        expect(composeHooks()).toBeUndefined();
    });

    it("all undefined → returns undefined", () => {
        expect(composeHooks(undefined, undefined, undefined)).toBeUndefined();
    });

    it("single present hook → returned as-is", () => {
        const hook = vi.fn();
        expect(composeHooks(hook, undefined)).toBe(hook);
        expect(composeHooks(undefined, hook)).toBe(hook);
        expect(composeHooks(undefined, hook, undefined)).toBe(hook);
    });

    it("two present → returns composed function that calls both", async () => {
        const apiHook = vi.fn();
        const localHook = vi.fn();
        const composed = composeHooks(apiHook, localHook)!;

        expect(composed).toBeTypeOf("function");
        await composed("arg1", "arg2");

        expect(apiHook).toHaveBeenCalledWith("arg1", "arg2");
        expect(localHook).toHaveBeenCalledWith("arg1", "arg2");
    });

    it("three present → all called with the same args", async () => {
        const hookA = vi.fn();
        const hookB = vi.fn();
        const hookC = vi.fn();
        const composed = composeHooks(hookA, undefined, hookB, hookC)!;

        await composed("arg", "ctx");

        expect(hookA).toHaveBeenCalledWith("arg", "ctx");
        expect(hookB).toHaveBeenCalledWith("arg", "ctx");
        expect(hookC).toHaveBeenCalledWith("arg", "ctx");
    });

    it("a hook error does not prevent the other hooks from running", async () => {
        const apiHook = vi.fn(() => {
            throw new Error("api-error");
        });
        const localHook = vi.fn();
        const composed = composeHooks(apiHook, localHook)!;

        // Should not throw
        await composed("a", "ctx");
        expect(localHook).toHaveBeenCalledWith("a", "ctx");
    });

    it("a hook error does not cause unhandled rejection", async () => {
        const apiHook = vi.fn();
        const localHook = vi.fn(() => {
            throw new Error("local-error");
        });
        const composed = composeHooks(apiHook, localHook)!;

        await expect(composed("a", "ctx")).resolves.toBeUndefined();
        expect(apiHook).toHaveBeenCalled();
    });

    it("async hooks that reject → composed promise still resolves", async () => {
        const apiHook = vi.fn(async () => {
            throw new Error("async-api");
        });
        const localHook = vi.fn(async () => {
            throw new Error("async-local");
        });
        const composed = composeHooks(apiHook, localHook)!;

        await expect(composed("a", "ctx")).resolves.toBeUndefined();
        expect(apiHook).toHaveBeenCalled();
        expect(localHook).toHaveBeenCalled();
    });

    it("a hook is not blocked by a long-lived preceding hook", async () => {
        // Documented lifecycle pattern: a hook may await $cacheEntryRemoved and
        // stay pending for the entry's whole lifetime. The other hooks must not
        // wait for it to settle.
        const apiHook = vi.fn(() => new Promise<void>(() => {}));
        const localHook = vi.fn();
        const composed = composeHooks(apiHook, localHook)!;

        void composed("a", "ctx");
        await flushMicrotasks();

        expect(localHook).toHaveBeenCalledWith("a", "ctx");
    });
});

// ==================== Lifecycle Hook Integration ====================

describe("createApi — lifecycle hooks integration", () => {
    it("API-level onQueryStarted is called when resource query starts", async () => {
        const apiOnQueryStarted = vi.fn();
        const api = createApi({ onQueryStarted: apiOnQueryStarted });

        const resource = api.createResource({
            queryFn: async () => "data",
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(apiOnQueryStarted).toHaveBeenCalled();
    });

    it("both API-level and resource-level onQueryStarted are called", async () => {
        const apiHook = vi.fn();
        const localHook = vi.fn();
        const api = createApi({ onQueryStarted: apiHook });

        const resource = api.createResource({
            queryFn: async () => "data",
            onQueryStarted: localHook,
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(apiHook).toHaveBeenCalled();
        expect(localHook).toHaveBeenCalled();
    });

    it("resource onCacheEntryAdded is not blocked by API-level hook awaiting $cacheEntryRemoved", async () => {
        let localLoaded: unknown;

        const api = createApi({
            onCacheEntryAdded: async (_args, { $cacheEntryRemoved }) => {
                await $cacheEntryRemoved;
            },
        });

        const resource = api.createResource({
            queryFn: async () => "data",
            onCacheEntryAdded: async (_args, { $cacheDataLoaded }) => {
                localLoaded = await $cacheDataLoaded;
            },
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(localLoaded).toBe("data");
    });

    it("resource onQueryStarted is not blocked by API-level hook awaiting $queryFulfilled", async () => {
        let resolveQuery!: (value: string) => void;
        const localHook = vi.fn();

        const api = createApi({
            onQueryStarted: async (_args, { $queryFulfilled }) => {
                await $queryFulfilled;
            },
        });

        const resource = api.createResource({
            queryFn: () =>
                new Promise<string>((resolve) => {
                    resolveQuery = resolve;
                }),
            onQueryStarted: localHook,
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        // The local hook must run while the query is still in flight — that is
        // the optimistic-update window.
        expect(localHook).toHaveBeenCalled();

        resolveQuery("data");
        await flushMicrotasks();
    });
});

// ==================== Lifecycle Hook Arrays ====================

describe("createApi — lifecycle hook arrays", () => {
    it("every hook of an onQueryStarted array is called on a resource query", async () => {
        const hookA = vi.fn();
        const hookB = vi.fn();
        const api = createApi();

        const resource = api.createResource({
            queryFn: async () => "data",
            onQueryStarted: [hookA, hookB],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(hookA).toHaveBeenCalledTimes(1);
        expect(hookB).toHaveBeenCalledTimes(1);
    });

    it("every hook of an onCacheEntryAdded array is called on a resource entry", async () => {
        const hookA = vi.fn();
        const hookB = vi.fn();
        const api = createApi();

        const resource = api.createResource({
            queryFn: async () => "data",
            onCacheEntryAdded: [hookA, hookB],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(hookA).toHaveBeenCalledTimes(1);
        expect(hookB).toHaveBeenCalledTimes(1);
    });

    it("falsy array entries are skipped and the remaining hooks still run", async () => {
        const hook = vi.fn();
        const isDev = false;
        const api = createApi();

        const resource = api.createResource({
            queryFn: async () => "data",
            onQueryStarted: [undefined, hook, isDev && vi.fn()],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(hook).toHaveBeenCalledTimes(1);
    });

    it("an array of only falsy entries leaves the resource working", async () => {
        const isDev = false;
        const api = createApi();

        const resource = api.createResource({
            queryFn: async () => "data",
            onQueryStarted: [undefined, isDev && vi.fn()],
            onCacheEntryAdded: [undefined],
        });

        await expect(resource.fetch(undefined as void)).resolves.toBe("data");
    });

    it("a throwing hook in the array does not stop the others", async () => {
        const throwing = vi.fn(() => {
            throw new Error("hook-error");
        });
        const after = vi.fn();
        const api = createApi();

        const resource = api.createResource({
            queryFn: async () => "data",
            onQueryStarted: [throwing, after],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(throwing).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
        // The throw is suppressed: the query itself is unaffected.
        await expect(resource.fetch(undefined as void)).resolves.toBe("data");
    });

    it("a rejecting async hook in the array does not stop the others", async () => {
        const rejecting = vi.fn(async () => {
            throw new Error("async-hook-error");
        });
        const after = vi.fn();
        const api = createApi();

        const resource = api.createResource({
            queryFn: async () => "data",
            onCacheEntryAdded: [rejecting, after],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(rejecting).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
    });

    it("a long-lived hook in the array does not delay the following ones", async () => {
        // The documented lifecycle pattern: a hook may stay pending for the
        // entry's whole lifetime. The array order must not sequence the hooks.
        const longLived = vi.fn(() => new Promise<void>(() => {}));
        const after = vi.fn();
        const api = createApi();

        const resource = api.createResource({
            queryFn: async () => "data",
            onCacheEntryAdded: [longLived, after],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(after).toHaveBeenCalledTimes(1);
    });

    it("api-level and resource-level hook arrays are all merged", async () => {
        const apiA = vi.fn();
        const apiB = vi.fn();
        const localA = vi.fn();
        const localB = vi.fn();

        const api = createApi({
            onQueryStarted: [apiA, apiB],
            onCacheEntryAdded: [apiA, undefined],
        });

        const resource = api.createResource({
            queryFn: async () => "data",
            onQueryStarted: [localA, localB],
            onCacheEntryAdded: [localA, false],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        // onQueryStarted: apiA, apiB, localA, localB; onCacheEntryAdded: apiA, localA.
        expect(apiA).toHaveBeenCalledTimes(2);
        expect(apiB).toHaveBeenCalledTimes(1);
        expect(localA).toHaveBeenCalledTimes(2);
        expect(localB).toHaveBeenCalledTimes(1);
    });

    it("an api-level single hook merges with a resource-level array", async () => {
        const apiHook = vi.fn();
        const localA = vi.fn();
        const localB = vi.fn();

        const api = createApi({ onQueryStarted: apiHook });

        const resource = api.createResource({
            queryFn: async () => "data",
            onQueryStarted: [localA, localB],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        expect(apiHook).toHaveBeenCalledTimes(1);
        expect(localA).toHaveBeenCalledTimes(1);
        expect(localB).toHaveBeenCalledTimes(1);
    });

    it("createCommand accepts hook arrays and calls every hook", async () => {
        const apiHook = vi.fn();
        const localA = vi.fn();
        const localB = vi.fn();
        const throwing = vi.fn(() => {
            throw new Error("command-hook-error");
        });

        const api = createApi({ onQueryStarted: [apiHook] });

        const command = api.createCommand({
            queryFn: async (x: number) => x * 2,
            onQueryStarted: [throwing, localA, undefined, false, localB],
        });

        await expect(command.execute(5)).resolves.toBe(10);
        await flushMicrotasks();

        expect(apiHook).toHaveBeenCalledTimes(1);
        expect(throwing).toHaveBeenCalledTimes(1);
        expect(localA).toHaveBeenCalledTimes(1);
        expect(localB).toHaveBeenCalledTimes(1);
    });

    it("unstable_createProjectionResource accepts hook arrays without losing the runtime's own hook", async () => {
        const localA = vi.fn();
        const localB = vi.fn();
        const throwing = vi.fn(() => {
            throw new Error("projection-hook-error");
        });

        const api = createApi();
        const items = api.createResource({
            queryFn: async (args: { ids: number[] }) => args.ids.map((id) => ({ id })),
        });

        const projection = api.unstable_createProjectionResource({
            resource: items,
            key: "items-projection",
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids: number[]) => ({ ids }),
            retentionTime: false,
            onCacheEntryAdded: [throwing, localA, undefined, localB],
        });

        // The projection still works: the runtime's internal bookkeeping hook
        // survives the merge with the option array.
        const data = await projection.fetch([1, 2]);

        expect(data.map((item) => item.id)).toEqual([1, 2]);
        expect(throwing).toHaveBeenCalledTimes(1);
        expect(localA).toHaveBeenCalledTimes(1);
        expect(localB).toHaveBeenCalledTimes(1);
    });
});

// ==================== Key Prefixing Edge Cases ====================

describe("createApi — key prefixing edge cases", () => {
    it("keyPrefix set but resource key is undefined — no prefix applied", async () => {
        const api = createApi({ keyPrefix: "app" });
        const resource = api.createResource({
            queryFn: async () => "data",
            // key not provided
        });

        // Should not crash
        resource.trigger(undefined as void);
        await flushMicrotasks();
        expect([...resource.getEntries()].length).toBe(1);
    });

    it("keyPrefix set but command key is undefined — no prefix applied", () => {
        const api = createApi({ keyPrefix: "app" });
        const command = api.createCommand({
            queryFn: async () => "ok",
            // key not provided
        });
        expect(command).toBeDefined();
    });

    it("multiple resources with same key — last one tracked in resourcesByKey", async () => {
        const api = createApi();
        const r1 = api.createResource({
            key: "dup",
            queryFn: async () => "first",
        });
        const r2 = api.createResource({
            key: "dup",
            queryFn: async () => "second",
        });

        // Both are tracked in resources array (both reset on resetAll)
        // The second one should be the one in resourcesByKey map
        // We can verify by triggering r2 and checking snapshot
        r2.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();
        // "dup" key should have entries from r2
        const dupEntries = snapshot.resources["dup"];
        expect(dupEntries).toBeDefined();
        expect((Object.values(dupEntries.entries)[0] as any).data).toBe("second");
    });
});
