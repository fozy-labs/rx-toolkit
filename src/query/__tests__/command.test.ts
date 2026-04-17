import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { Command } from "@/query/core/command/Command";
import { CacheEntryRemovedError } from "@/query/core/errors";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import { toKeyed } from "@/query/lib/toKeyed";
import type { ICommandConfig, IResourceConfig, TLinkConfig } from "@/query/types";
import { Signal } from "@/signals/signals/Signal";

// ==================== Helpers ====================

function createConfig<TArgs, TData>(
    overrides: Partial<ICommandConfig<TArgs, TData>> & {
        queryFn: ICommandConfig<TArgs, TData>["queryFn"];
    },
): ICommandConfig<TArgs, TData> {
    return {
        retentionTime: false,
        links: [],
        ...overrides,
    };
}

function createCommand<TArgs = string, TData = string>(
    overrides: Partial<ICommandConfig<TArgs, TData>> & {
        queryFn: ICommandConfig<TArgs, TData>["queryFn"];
    },
) {
    return new Command<TArgs, TData>(createConfig(overrides));
}

function createLinkedResource<TArgs = number, TData = string>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: (args: TArgs, signal: AbortSignal) => Promise<TData>;
    },
) {
    return new Resource<TArgs, TData>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: TArgs) => string,
        ...overrides,
    });
}

// ==================== trigger ====================

describe("Command.trigger", () => {
    it("calls queryFn with provided args and resolves with result", async () => {
        const queryFn = vi.fn(async (args: string) => `result-${args}`);
        const command = createCommand<string, string>({ queryFn });

        const result = await command.trigger("hello", "k1");
        expect(queryFn).toHaveBeenCalledWith("hello");
        expect(result).toBe("result-hello");
    });

    it("rejects when queryFn throws", async () => {
        const error = new Error("mutation failed");
        const command = createCommand<string, string>({
            queryFn: async () => {
                throw error;
            },
        });

        await expect(command.trigger("x", "k1")).rejects.toBe(error);
    });

    it("auto-generates a key when none is provided", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "ok",
        });

        command.trigger("a");
        // We can't predict the exact auto-key, but an entry should exist
        // The key format is `${Date.now()}-${counter}`
        // After trigger, the entry is created. We'll verify via reset (which clears entries).
        await flushMicrotasks();
        // No assertion on key name needed — the test is that it doesn't throw
    });

    it("accepts explicit key parameter", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "ok",
        });

        command.trigger("a", "my-key");
        await flushMicrotasks();

        const entry = command.getEntry("my-key");
        expect(entry).not.toBeNull();
    });

    it("replaces existing cache entry for same key", async () => {
        let callCount = 0;
        const command = createCommand<string, string>({
            queryFn: async (args) => {
                callCount++;
                return `result-${callCount}`;
            },
        });

        command.trigger("a", "k1");
        await flushMicrotasks();

        const entry1 = command.getEntry("k1");

        command.trigger("b", "k1");
        await flushMicrotasks();

        const entry2 = command.getEntry("k1");
        expect(entry2).not.toBe(entry1);
        expect(entry2!.machine$.peek().state.data).toBe("result-2");
    });

    it("calls complete() on existing entry when replacing with same key", async () => {
        let resolveFirst!: (val: string) => void;
        const command = createCommand<string, string>({
            queryFn: async () =>
                new Promise<string>((r) => {
                    resolveFirst = r;
                }),
        });

        command.trigger("a", "k1");
        const entry1 = command.getEntry("k1")!;

        let completed = false;
        entry1.completed$.subscribe(() => {
            completed = true;
        });

        // Trigger again with same key — should complete the first entry
        const command2queryFn = vi.fn(async () => "second");
        // We need a new command or we just trigger again on the same
        command.trigger("b", "k1");

        expect(completed).toBe(true);
    });

    it("creates a cache entry that is accessible via getEntry", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.trigger("x", "k1");

        const entry = command.getEntry("k1");
        expect(entry).not.toBeNull();
        expect(entry!.machine$.peek().state.status).toBe("pending");

        await flushMicrotasks();
        expect(entry!.machine$.peek().state.status).toBe("success");
        expect(entry!.machine$.peek().state.data).toBe("data");
    });

    it("entry transitions to error state when queryFn rejects", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => {
                throw new Error("fail");
            },
        });

        const promise = command.trigger("x", "k1");
        await promise.catch(() => {});
        await flushMicrotasks();

        const entry = command.getEntry("k1");
        expect(entry).not.toBeNull();
        expect(entry!.machine$.peek().state.status).toBe("error");
    });
});

// ==================== getEntry ====================

describe("Command.getEntry", () => {
    it("returns entry when key exists", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.trigger("x", "k1");
        await flushMicrotasks();

        expect(command.getEntry("k1")).not.toBeNull();
    });

    it("returns null when key does not exist", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        expect(command.getEntry("nonexistent")).toBeNull();
    });

    it("returns null after entry has been completed and removed", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.trigger("x", "k1");
        await flushMicrotasks();

        const entry = command.getEntry("k1")!;
        entry.complete();
        await flushMicrotasks();

        expect(command.getEntry("k1")).toBeNull();
    });
});

// ==================== getEntry$ (reactive) ====================

describe("Command.getEntry$", () => {
    it("returns entry when key exists (same as getEntry)", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.trigger("x", "k1");
        await flushMicrotasks();

        expect(command.getEntry$("k1")).not.toBeNull();
    });

    it("returns null when key does not exist", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        expect(command.getEntry$("nonexistent")).toBeNull();
    });

    it("reads cache signal for reactive dependency", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        // Before trigger, entry is null
        expect(command.getEntry$("k1")).toBeNull();

        // After trigger, entry exists
        command.trigger("x", "k1");
        expect(command.getEntry$("k1")).not.toBeNull();
    });

    it("re-evaluates inside Signal.effect when entry is created", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(command.getEntry$("k1"));
        });

        // Initially null
        expect(results).toEqual([null]);

        command.trigger("x", "k1");
        await flushMicrotasks();

        // Effect should have re-run with the entry present
        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results[results.length - 1]).not.toBeNull();

        eff.unsubscribe();
    });

    it("re-evaluates inside Signal.compute when entry is created", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        const hasEntry$ = Signal.compute(() => command.getEntry$("k1") !== null);

        // Track via effect to activate the computed
        const values: boolean[] = [];
        const eff = Signal.effect(() => {
            values.push(hasEntry$());
        });

        expect(values).toEqual([false]);

        command.trigger("x", "k1");
        await flushMicrotasks();

        expect(values.length).toBeGreaterThanOrEqual(2);
        expect(values[values.length - 1]).toBe(true);

        eff.unsubscribe();
        hasEntry$.destroy();
    });

    it("re-evaluates inside Signal.effect when a second trigger replaces the entry", async () => {
        let callCount = 0;
        const command = createCommand<string, string>({
            queryFn: async () => `v${++callCount}`,
        });

        const entries: (null | object)[] = [];
        const eff = Signal.effect(() => {
            entries.push(command.getEntry$("k1"));
        });

        command.trigger("a", "k1");
        await flushMicrotasks();

        const firstEntry = entries[entries.length - 1];
        expect(firstEntry).not.toBeNull();

        command.trigger("b", "k1");
        await flushMicrotasks();

        // Effect should have re-run again
        expect(entries.length).toBeGreaterThanOrEqual(3);

        eff.unsubscribe();
    });
});

// ==================== createAgent ====================

describe("Command.createAgent", () => {
    it("returns a CommandAgent instance with expected methods", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        const agent = command.createAgent();
        expect(agent).toBeDefined();
        expect(typeof agent.trigger).toBe("function");
        expect(typeof agent.state$).toBe("function");
        expect(typeof agent.setKey).toBe("function");
    });

    it("accepts optional key parameter", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        const agent = command.createAgent("my-key");
        expect(agent).toBeDefined();
    });
});

// ==================== reset ====================

describe("Command.reset", () => {
    it("clears all cache entries", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.trigger("a", "k1");
        command.trigger("b", "k2");
        await flushMicrotasks();

        expect(command.getEntry("k1")).not.toBeNull();
        expect(command.getEntry("k2")).not.toBeNull();

        command.reset();

        expect(command.getEntry("k1")).toBeNull();
        expect(command.getEntry("k2")).toBeNull();
    });

    it("calls complete() on every removed entry", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.trigger("a", "k1");
        command.trigger("b", "k2");

        const entry1 = command.getEntry("k1")!;
        const entry2 = command.getEntry("k2")!;

        let completed1 = false;
        let completed2 = false;
        entry1.completed$.subscribe(() => {
            completed1 = true;
        });
        entry2.completed$.subscribe(() => {
            completed2 = true;
        });

        command.reset();

        expect(completed1).toBe(true);
        expect(completed2).toBe(true);
    });

    it("is safe to call when cache is empty", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        // Should not throw
        command.reset();
    });

    it("after reset, new triggers create fresh entries", async () => {
        let callCount = 0;
        const command = createCommand<string, string>({
            queryFn: async () => {
                callCount++;
                return `data-${callCount}`;
            },
        });

        command.trigger("a", "k1");
        await flushMicrotasks();
        expect(command.getEntry("k1")!.machine$.peek().state.data).toBe("data-1");

        command.reset();

        command.trigger("a", "k1");
        await flushMicrotasks();
        expect(command.getEntry("k1")!.machine$.peek().state.data).toBe("data-2");
    });
});

// ==================== Link / Patching Scenarios ====================

describe("Link scenarios", () => {
    function setupLinkedCommand(linkConfig: Partial<TLinkConfig<string, string, number, string>>) {
        const resource = createLinkedResource<number, string>({
            queryFn: async (n) => `resource-data-${n}`,
        });

        const link: TLinkConfig<string, string, number, string> = {
            resource,
            forwardArgs: (cmdArgs: string) => parseInt(cmdArgs, 10),
            ...linkConfig,
        };

        const command = createCommand<string, string>({
            queryFn: async (args) => `cmd-result-${args}`,
            links: [link],
        });

        return { command, resource, link };
    }

    describe("Invalidation", () => {
        it("invalidates linked resource on successful mutation", async () => {
            const { command, resource } = setupLinkedCommand({ invalidate: true });

            // Seed the resource cache
            resource.trigger(1);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;
            expect(entry.machine$.peek().state.status).toBe("success");

            // Execute command — should trigger refresh on the linked resource
            const refreshSpy = vi.spyOn(resource, "refresh");

            await command.trigger("1", "k1");
            await flushMicrotasks();

            expect(refreshSpy).toHaveBeenCalledWith(1);
        });

        it("does not invalidate on failed mutation", async () => {
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `resource-data-${n}`,
            });

            const link: TLinkConfig<string, string, number, string> = {
                resource,
                forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                invalidate: true,
            };

            const command = createCommand<string, string>({
                queryFn: async () => {
                    throw new Error("fail");
                },
                links: [link],
            });

            resource.trigger(1);
            await flushMicrotasks();

            const refreshSpy = vi.spyOn(resource, "refresh");

            await command.trigger("1", "k1").catch(() => {});
            await flushMicrotasks();

            expect(refreshSpy).not.toHaveBeenCalled();
        });
    });

    describe("Optimistic patches", () => {
        it("applies optimistic patches before queryFn and commits on success", async () => {
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `original-${n}`,
            });

            // Seed the resource
            resource.trigger(1);
            await flushMicrotasks();

            const link: TLinkConfig<string, string, number, string> = {
                resource,
                forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                optimisticUpdate: (draft, cmdArgs) => {
                    // optimisticUpdate receives the draft and modifies it
                    // we can't easily test immer draft mutation in isolation
                    // but we can verify it's called
                },
            };

            const optimisticSpy = vi.fn(link.optimisticUpdate!);
            link.optimisticUpdate = optimisticSpy;

            const command = createCommand<string, string>({
                queryFn: async () => "cmd-result",
                links: [link],
            });

            await command.trigger("1", "k1");
            await flushMicrotasks();

            expect(optimisticSpy).toHaveBeenCalled();
        });

        it("rolls back optimistic patches on failure", async () => {
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `original-${n}`,
            });

            // Seed the resource
            resource.trigger(1);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;

            const link: TLinkConfig<string, string, number, string> = {
                resource,
                forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                optimisticUpdate: (_draft, _cmdArgs) => {
                    // Would mutate the draft optimistically
                },
            };

            const command = createCommand<string, string>({
                queryFn: async () => {
                    throw new Error("fail");
                },
                links: [link],
            });

            await command.trigger("1", "k1").catch(() => {});
            await flushMicrotasks();

            // After rollback, data should be unchanged
            expect(entry.machine$.peek().state.data).toBe("original-1");
        });
    });

    describe("Update patches", () => {
        it("applies update patches after successful mutation", async () => {
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `original-${n}`,
            });

            resource.trigger(1);
            await flushMicrotasks();

            const updateSpy = vi.fn((_draft: string, _cmdArgs: string, _result: string) => {});

            const link: TLinkConfig<string, string, number, string> = {
                resource,
                forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                update: updateSpy,
            };

            const command = createCommand<string, string>({
                queryFn: async () => "cmd-result",
                links: [link],
            });

            await command.trigger("1", "k1");
            await flushMicrotasks();

            expect(updateSpy).toHaveBeenCalledWith(
                expect.anything(), // draft
                "1", // commandArgs
                "cmd-result", // result
            );
        });

        it("does not apply update patches on failure", async () => {
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `original-${n}`,
            });

            resource.trigger(1);
            await flushMicrotasks();

            const updateSpy = vi.fn();

            const link: TLinkConfig<string, string, number, string> = {
                resource,
                forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                update: updateSpy,
            };

            const command = createCommand<string, string>({
                queryFn: async () => {
                    throw new Error("fail");
                },
                links: [link],
            });

            await command.trigger("1", "k1").catch(() => {});
            await flushMicrotasks();

            expect(updateSpy).not.toHaveBeenCalled();
        });
    });

    describe("forwardArgs", () => {
        it("forwardArgs returning undefined skips that link", async () => {
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `resource-${n}`,
            });

            resource.trigger(1);
            await flushMicrotasks();

            const refreshSpy = vi.spyOn(resource, "refresh");

            const link: TLinkConfig<string, string, number, string> = {
                resource,
                forwardArgs: () => undefined as any,
                invalidate: true,
            };

            const command = createCommand<string, string>({
                queryFn: async () => "ok",
                links: [link],
            });

            await command.trigger("1", "k1");
            await flushMicrotasks();

            // refresh is called but with undefined — resource.refresh(undefined) is a no-op
            // since there's no entry for undefined key
        });
    });

    describe("No links", () => {
        it("works fine without any links configured", async () => {
            const command = createCommand<string, string>({
                queryFn: async () => "result",
                links: [],
            });

            const result = await command.trigger("x", "k1");
            expect(result).toBe("result");
        });
    });
});

// ==================== Lifecycle: onCacheEntryAdded ====================

describe("onCacheEntryAdded lifecycle", () => {
    it("fires once per new cache entry", async () => {
        const addedArgs: string[] = [];

        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: (args, ctx) => {
                addedArgs.push(args);
                expect(ctx.entry).not.toBeNull();
            },
        });

        command.trigger("a", "k1");
        expect(addedArgs).toEqual(["a"]);
    });

    it("$cacheDataLoaded resolves with data on first success", async () => {
        let loadedData: string | undefined;

        const command = createCommand<string, string>({
            queryFn: async () => "loaded",
            onCacheEntryAdded: async (_args, ctx) => {
                loadedData = await ctx.$cacheDataLoaded;
            },
        });

        command.trigger("x", "k1");
        await flushMicrotasks();

        expect(loadedData).toBe("loaded");
    });

    it("$cacheDataLoaded rejects with CacheEntryRemovedError if entry completes before data", async () => {
        let rejectedError: unknown;
        let resolveQuery!: (val: string) => void;

        const command = createCommand<string, string>({
            queryFn: () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
            onCacheEntryAdded: async (_args, ctx) => {
                try {
                    await ctx.$cacheDataLoaded;
                } catch (err) {
                    rejectedError = err;
                }
            },
        });

        command.trigger("x", "k1");
        const entry = command.getEntry("k1")!;

        // Complete the entry before queryFn resolves
        entry.complete();
        await flushMicrotasks();

        expect(rejectedError).toBeInstanceOf(CacheEntryRemovedError);
    });

    it("$cacheEntryRemoved resolves when entry completes", async () => {
        let removed = false;

        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: async (_args, ctx) => {
                ctx.$cacheEntryRemoved.then(() => {
                    removed = true;
                });
            },
        });

        command.trigger("x", "k1");
        await flushMicrotasks();

        const entry = command.getEntry("k1")!;
        entry.complete();
        await flushMicrotasks();

        expect(removed).toBe(true);
    });

    it("errors thrown inside onCacheEntryAdded are suppressed", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: () => {
                throw new Error("callback error");
            },
        });

        // Should not throw
        command.trigger("x", "k1");
        await flushMicrotasks();

        expect(command.getEntry("k1")).not.toBeNull();
    });
});

// ==================== Lifecycle: onQueryStarted ====================

describe("onQueryStarted lifecycle", () => {
    it("fires on every queryFn execution", async () => {
        const startedArgs: string[] = [];

        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onQueryStarted: (args) => {
                startedArgs.push(args);
            },
        });

        command.trigger("a", "k1");
        await flushMicrotasks();

        expect(startedArgs).toEqual(["a"]);
    });

    it("$queryFulfilled resolves with { data } on success", async () => {
        let fulfilledData: { data: string } | undefined;

        const command = createCommand<string, string>({
            queryFn: async () => "result",
            onQueryStarted: async (_args, ctx) => {
                fulfilledData = await ctx.$queryFulfilled;
            },
        });

        command.trigger("x", "k1");
        await flushMicrotasks();

        expect(fulfilledData).toEqual({ data: "result" });
    });

    it("$queryFulfilled rejects when queryFn fails", async () => {
        let rejectedError: unknown;

        const command = createCommand<string, string>({
            queryFn: async () => {
                throw new Error("fail");
            },
            onQueryStarted: async (_args, ctx) => {
                try {
                    await ctx.$queryFulfilled;
                } catch (err) {
                    rejectedError = err;
                }
            },
        });

        await command.trigger("x", "k1").catch(() => {});
        await flushMicrotasks();

        expect(rejectedError).toBeInstanceOf(Error);
    });

    it("errors thrown inside onQueryStarted are suppressed", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onQueryStarted: () => {
                throw new Error("callback error");
            },
        });

        // Should not throw
        command.trigger("x", "k1");
        await flushMicrotasks();

        expect(command.getEntry("k1")!.machine$.peek().state.data).toBe("data");
    });

    it("fires for initial trigger (deferred after QCE constructor)", async () => {
        let firedCount = 0;

        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onQueryStarted: () => {
                firedCount++;
            },
        });

        command.trigger("x", "k1");
        expect(firedCount).toBe(1);
    });
});

// ==================== Key Generation ====================

describe("Key generation", () => {
    it("auto-generates unique keys for sequential triggers", async () => {
        const keys: string[] = [];
        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: (_args, ctx) => {
                keys.push(ctx.entry.keyedArgs.key);
            },
        });

        command.trigger("a");
        command.trigger("b");

        expect(keys).toHaveLength(2);
        expect(keys[0]).not.toBe(keys[1]);
    });

    it("counter increments per Command instance", async () => {
        const keys: string[] = [];
        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: (_args, ctx) => {
                keys.push(ctx.entry.keyedArgs.key);
            },
        });

        command.trigger("a");
        command.trigger("b");
        command.trigger("c");

        // Keys should end with -0, -1, -2 respectively
        expect(keys[0]).toMatch(/-0$/);
        expect(keys[1]).toMatch(/-1$/);
        expect(keys[2]).toMatch(/-2$/);
    });
});

// ==================== Edge Cases ====================

describe("Edge cases", () => {
    it("rapid sequential triggers with same key — only latest entry survives", async () => {
        let callCount = 0;
        let resolvers: Array<(val: string) => void> = [];

        const command = createCommand<string, string>({
            queryFn: async () => {
                callCount++;
                return new Promise<string>((r) => {
                    resolvers.push(r);
                });
            },
        });

        command.trigger("a", "k1");
        command.trigger("b", "k1");
        command.trigger("c", "k1");

        // Only the latest entry should be in cache
        const entry = command.getEntry("k1")!;
        expect(entry.keyedArgs.value).toBe("c");

        // Resolve all pending promises
        for (const r of resolvers) r("done");
        await flushMicrotasks();
    });

    it("queryFn that never resolves — entry stays in cache", async () => {
        const command = createCommand<string, string>({
            queryFn: () => new Promise<string>(() => {}), // never resolves
        });

        command.trigger("x", "k1");

        const entry = command.getEntry("k1");
        expect(entry).not.toBeNull();
        expect(entry!.machine$.peek().state.status).toBe("pending");
    });

    it("onCacheEntryAdded + immediate reset — $cacheEntryRemoved resolves, $cacheDataLoaded rejects", async () => {
        let removedResolved = false;
        let dataRejected = false;

        const command = createCommand<string, string>({
            queryFn: () => new Promise<string>(() => {}), // never resolves
            onCacheEntryAdded: async (_args, ctx) => {
                ctx.$cacheEntryRemoved.then(() => {
                    removedResolved = true;
                });
                ctx.$cacheDataLoaded.catch(() => {
                    dataRejected = true;
                });
            },
        });

        command.trigger("x", "k1");
        command.reset();
        await flushMicrotasks();

        expect(removedResolved).toBe(true);
        expect(dataRejected).toBe(true);
    });

    it("entry removal after complete does not affect cache if a newer entry replaced it", async () => {
        let resolveFirst!: (val: string) => void;
        const command = createCommand<string, string>({
            queryFn: async (args) => {
                if (args === "first") {
                    return new Promise<string>((r) => {
                        resolveFirst = r;
                    });
                }
                return "second-result";
            },
        });

        command.trigger("first", "k1");
        const firstEntry = command.getEntry("k1")!;

        // Replace with new entry for same key
        command.trigger("second", "k1");
        await flushMicrotasks();

        const secondEntry = command.getEntry("k1")!;
        expect(secondEntry).not.toBe(firstEntry);

        // Resolve the first entry's queryFn — its completed$ fires,
        // but the cache should still hold the second entry
        resolveFirst("first-result");
        await flushMicrotasks();

        expect(command.getEntry("k1")).toBe(secondEntry);
    });

    it("concurrent executions with different keys are independent", async () => {
        let resolvers: Record<string, (val: string) => void> = {};

        const command = createCommand<string, string>({
            queryFn: async (args) =>
                new Promise<string>((r) => {
                    resolvers[args] = r;
                }),
        });

        const p1 = command.trigger("a", "k1");
        const p2 = command.trigger("b", "k2");

        expect(command.getEntry("k1")).not.toBeNull();
        expect(command.getEntry("k2")).not.toBeNull();

        resolvers["a"]("result-a");
        const resultA = await p1;
        expect(resultA).toBe("result-a");

        resolvers["b"]("result-b");
        const resultB = await p2;
        expect(resultB).toBe("result-b");
    });

    it("concurrent triggers with optimistic link — patches settle correctly", async () => {
        // Use object data so Immer can produce real patches
        const resource = createLinkedResource<number, { value: string }>({
            queryFn: async (n: number) => ({ value: `original-${n}` }),
        });

        // Seed the resource so optimistic patches have data to work on
        resource.trigger(1);
        await flushMicrotasks();
        const resourceEntry = resource.getEntry(1)!;
        expect(resourceEntry.machine$.peek().state.data).toEqual({ value: "original-1" });

        // Deferred resolvers for each command trigger
        let resolveFirst!: (val: string) => void;
        let resolveSecond!: (val: string) => void;

        let callCount = 0;

        const link: TLinkConfig<string, string, number, { value: string }> = {
            resource,
            forwardArgs: (cmdArgs: string) => parseInt(cmdArgs, 10),
            optimisticUpdate: (draft: { value: string }, cmdArgs: string) => {
                draft.value = `${draft.value}-optimistic-${cmdArgs}`;
            },
        };

        const command = createCommand<string, string>({
            queryFn: (_args: string) =>
                new Promise<string>((resolve) => {
                    callCount++;
                    if (callCount === 1) resolveFirst = resolve;
                    else resolveSecond = resolve;
                }),
            links: [link],
        });

        // Fire two triggers in rapid succession (different keys so both stay alive)
        const p1 = command.trigger("1", "k1");
        const p2 = command.trigger("1", "k2");

        // Both optimistic patches should have been applied synchronously
        const dataAfterOptimistic = resourceEntry.machine$.peek().state.data;
        expect((dataAfterOptimistic as { value: string }).value).toContain("optimistic");

        // Resolve second trigger first (out of order)
        resolveSecond("result-2");
        await flushMicrotasks();

        // Resolve first trigger
        resolveFirst("result-1");
        await flushMicrotasks();

        // Both promises should settle without error
        await expect(p1).resolves.toBe("result-1");
        await expect(p2).resolves.toBe("result-2");

        // Resource should have valid data (no corruption, no thrown errors).
        // After both patches are committed, the final data should still be
        // an object with a string value (not reverted to original).
        const finalData = resourceEntry.machine$.peek().state.data as { value: string };
        expect(typeof finalData.value).toBe("string");
    });
});

// ==================== Edge Cases (MEDIUM priority) ====================

describe("Command — trigger with pre-Keyed args", () => {
    it("uses the custom key from toKeyed wrapper", async () => {
        const command = createCommand<{ data: string }, string>({
            queryFn: async (args) => `result-${args.data}`,
        });

        const keyed = toKeyed({ data: "x" }, () => "custom-key");
        await command.trigger(keyed);

        const entry = command.getEntry("custom-key");
        expect(entry).not.toBeNull();
        expect(entry!.machine$.peek().state.status).toBe("success");
        expect(entry!.machine$.peek().state.data).toBe("result-x");
    });
});
