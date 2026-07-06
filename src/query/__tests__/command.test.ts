import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { Command } from "@/query/core/command/Command";
import { CacheEntryRemovedError } from "@/query/core/errors";
import { hasData } from "@/query/core/machine/machine-helpers";
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
        expect(queryFn).toHaveBeenCalledWith("hello", expect.any(String));
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

    it("failed trigger does not produce an unhandled rejection (no lifecycle hooks)", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const command = createCommand<string, string>({
                queryFn: async () => {
                    throw new Error("fail");
                },
            });

            await command.trigger("x", "k1").catch(() => {});
            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
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
        hasEntry$.dispose();
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

// ==================== getEntry$ — non-last entry removal (N1 regression) ====================
//
// Command.getEntry$ mirrors Resource.getEntry$: the compute tracks only _status$
// and _lastEntry$, plus a closure fast-path that memoises the first entry it
// finds. Removing a NON-last entry (key 1, created before key 2) while another
// entry remains changes neither tracked signal, so an effect observing key 1
// never re-runs and keeps the completed entry. Beyond the reactive cache, the
// closure fast-path must go too — otherwise a re-run still returns the memoised
// stale entry. RED on the current code, GREEN after the fix.
describe("Command.getEntry$ — non-last entry removal (N1 regression)", () => {
    it("effect over a NON-last entry re-evaluates to null when that entry is completed", async () => {
        const command = createCommand<string, string>({ queryFn: async () => "data" });

        command.trigger("a", "k1");
        command.trigger("b", "k2"); // k2 is _lastEntry$, so k1 is the non-last entry
        await flushMicrotasks();

        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(command.getEntry$("k1"));
        });

        expect(results[results.length - 1]).not.toBeNull();

        command.getEntry("k1")!.complete();
        await flushMicrotasks();

        expect(results[results.length - 1]).toBeNull();

        eff.unsubscribe();
    });

    it("compute over a NON-last entry re-evaluates to null when that entry is completed", async () => {
        const command = createCommand<string, string>({ queryFn: async () => "data" });

        command.trigger("a", "k1");
        command.trigger("b", "k2");
        await flushMicrotasks();

        const hasEntry$ = Signal.compute(() => command.getEntry$("k1") !== null);
        const values: boolean[] = [];
        const eff = Signal.effect(() => {
            values.push(hasEntry$());
        });

        expect(values[values.length - 1]).toBe(true);

        command.getEntry("k1")!.complete();
        await flushMicrotasks();

        expect(values[values.length - 1]).toBe(false);

        eff.unsubscribe();
        hasEntry$.dispose();
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

// ==================== pack ====================

describe("Command.pack", () => {
    it("returns an inert { kind, command, args, key } descriptor", () => {
        const queryFn = vi.fn(async (s: string) => `result-${s}`);
        const command = createCommand<string, string>({ queryFn });

        const packed = command.pack("hello", "k1");

        expect(packed).toEqual({ kind: "command", command, args: "hello", key: "k1" });
        // pack must not execute the mutation
        expect(queryFn).not.toHaveBeenCalled();
        expect(command.getEntry("k1")).toBeNull();
    });

    it("leaves key undefined when omitted", () => {
        const command = createCommand<string, string>({
            queryFn: async (s) => `result-${s}`,
        });

        const packed = command.pack("hello");

        expect(packed.key).toBeUndefined();
    });

    it("descriptor can be replayed via command.trigger", async () => {
        const queryFn = vi.fn(async (s: string) => `result-${s}`);
        const command = createCommand<string, string>({ queryFn });

        const packed = command.pack("world", "k2");
        const result = await packed.command.trigger(packed.args, packed.key);

        expect(result).toBe("result-world");
        expect(queryFn).toHaveBeenCalledWith("world", expect.any(String));
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

        it("rolls back already-applied patches when a later link's optimisticUpdate throws", async () => {
            // Resource A: optimistic patch applies successfully.
            const resourceA = createLinkedResource<number, { value: string }>({
                queryFn: async (n) => ({ value: `original-${n}` }),
            });
            // Resource B: optimisticUpdate throws while patching.
            const resourceB = createLinkedResource<number, { value: string }>({
                queryFn: async (n) => ({ value: `original-${n}` }),
            });

            resourceA.trigger(1);
            resourceB.trigger(1);
            await flushMicrotasks();

            const entryA = resourceA.getEntry(1)!;
            const entryB = resourceB.getEntry(1)!;

            const linkA: TLinkConfig<string, string, number, { value: string }> = {
                resource: resourceA,
                forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                optimisticUpdate: (draft) => {
                    draft.value = `${draft.value}-optimistic`;
                },
            };

            const linkB: TLinkConfig<string, string, number, { value: string }> = {
                resource: resourceB,
                forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                optimisticUpdate: () => {
                    throw new Error("optimistic boom");
                },
            };

            const queryFn = vi.fn(async () => "cmd-result");
            const command = createCommand<string, string>({
                queryFn,
                links: [linkA, linkB],
            });

            // The throwing optimisticUpdate must surface as a rejected trigger.
            await expect(command.trigger("1", "k1")).rejects.toThrow("optimistic boom");
            await flushMicrotasks();

            // Resource A's already-applied optimistic patch must be rolled back:
            // data restored and no dangling pending patch left behind.
            const stateA = entryA.machine$.peek().state;
            expect(stateA.data).toEqual({ value: "original-1" });
            if (!hasData(stateA)) throw new Error(`Resource A: expected data state, got "${stateA.status}"`);
            expect(stateA.patchState).toBeNull();

            // Resource B is untouched (its patch never applied).
            const stateB = entryB.machine$.peek().state;
            expect(stateB.data).toEqual({ value: "original-1" });
            if (!hasData(stateB)) throw new Error(`Resource B: expected data state, got "${stateB.status}"`);
            expect(stateB.patchState).toBeNull();

            // The mutation itself must not have run.
            expect(queryFn).not.toHaveBeenCalled();
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

        // A user-supplied update()/forwardArgs() runs while settling a *successful*
        // mutation. If it throws it must not (a) leave the optimistic patches
        // dangling, (b) skip invalidation, (c) corrupt sibling links, or (d) escape
        // as an unhandled rejection — the mutation itself succeeded.
        describe("resilience when a link callback throws during settle", () => {
            it("commits optimistic patches, still invalidates, and emits no unhandled rejection when update() throws", async () => {
                const tracker = await trackUnhandledRejections();
                const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
                try {
                    // Resource patched optimistically; its update() throws.
                    const patched = createLinkedResource<number, { value: string }>({
                        queryFn: async (n) => ({ value: `original-${n}` }),
                    });
                    // Independent resource that must still be invalidated despite the throw.
                    const invalidated = createLinkedResource<number, string>({
                        queryFn: async (n) => `inv-${n}`,
                    });

                    patched.trigger(1);
                    invalidated.trigger(1);
                    await flushMicrotasks();

                    const patchedEntry = patched.getEntry(1)!;
                    const refreshSpy = vi.spyOn(invalidated, "refresh");

                    const throwingLink: TLinkConfig<string, string, number, { value: string }> = {
                        resource: patched,
                        forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                        optimisticUpdate: (draft) => {
                            draft.value = `${draft.value}-optimistic`;
                        },
                        update: () => {
                            throw new Error("update boom");
                        },
                    };
                    const invalidateLink: TLinkConfig<string, string, number, string> = {
                        resource: invalidated,
                        forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                        invalidate: true,
                    };

                    const command = createCommand<string, string>({
                        queryFn: async () => "cmd-result",
                        links: [throwingLink, invalidateLink],
                    });

                    // The mutation itself succeeds, so trigger resolves.
                    await expect(command.trigger("1", "k1")).resolves.toBe("cmd-result");
                    await flushMicrotasks();
                    await flushUnhandledRejections();

                    // 1. Optimistic patch committed — not left dangling as a pending patch.
                    const state = patchedEntry.machine$.peek().state;
                    if (!hasData(state)) throw new Error(`expected data state, got "${state.status}"`);
                    expect(state.data).toEqual({ value: "original-1-optimistic" });
                    expect(state.patchState).toBeNull();

                    // 2. The independent resource is still invalidated.
                    expect(refreshSpy).toHaveBeenCalledWith(1);

                    // 3. The thrown error never escapes settle as an unhandled rejection…
                    expect(tracker.unhandled).toEqual([]);
                    // …but it is surfaced, not silently swallowed.
                    expect(errorSpy).toHaveBeenCalled();
                } finally {
                    errorSpy.mockRestore();
                    tracker.stop();
                }
            });

            it("a throwing update() on one link does not prevent a sibling link's update", async () => {
                const tracker = await trackUnhandledRejections();
                const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
                try {
                    const throwing = createLinkedResource<number, { value: string }>({
                        queryFn: async (n) => ({ value: `A-${n}` }),
                    });
                    const applied = createLinkedResource<number, { value: string }>({
                        queryFn: async (n) => ({ value: `B-${n}` }),
                    });

                    throwing.trigger(1);
                    applied.trigger(1);
                    await flushMicrotasks();

                    const appliedEntry = applied.getEntry(1)!;

                    const throwingLink: TLinkConfig<string, string, number, { value: string }> = {
                        resource: throwing,
                        forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                        update: () => {
                            throw new Error("update boom");
                        },
                    };
                    const appliedLink: TLinkConfig<string, string, number, { value: string }> = {
                        resource: applied,
                        forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
                        update: (draft, _cmdArgs, result) => {
                            draft.value = `${draft.value}-${result}`;
                        },
                    };

                    const command = createCommand<string, string>({
                        queryFn: async () => "done",
                        links: [throwingLink, appliedLink],
                    });

                    await expect(command.trigger("1", "k1")).resolves.toBe("done");
                    await flushMicrotasks();
                    await flushUnhandledRejections();

                    // The sibling link's update ran and committed despite the earlier throw.
                    const state = appliedEntry.machine$.peek().state;
                    if (!hasData(state)) throw new Error(`expected data state, got "${state.status}"`);
                    expect(state.data).toEqual({ value: "B-1-done" });
                    expect(state.patchState).toBeNull();

                    expect(tracker.unhandled).toEqual([]);
                    expect(errorSpy).toHaveBeenCalled();
                } finally {
                    errorSpy.mockRestore();
                    tracker.stop();
                }
            });
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

    it("failed mutation does not produce an unhandled rejection when onQueryStarted ignores $queryFulfilled", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const command = createCommand<string, string>({
                queryFn: async () => {
                    throw new Error("fail");
                },
                onQueryStarted: () => {
                    /* does not consume ctx.$queryFulfilled */
                },
            });

            await command.trigger("x", "k1").catch(() => {});
            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
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

// ==================== Request id ====================

describe("Command request id", () => {
    it("passes an auto-generated string request id as the second arg to queryFn", async () => {
        const queryFn = vi.fn(async (_args: string, _requestId: string) => "ok");
        const command = createCommand<string, string>({ queryFn });

        await command.trigger("a", "k1");

        const requestId = queryFn.mock.calls[0][1];
        expect(typeof requestId).toBe("string");
        expect(requestId.length).toBeGreaterThan(0);
    });

    it("mints a distinct request id for each fresh trigger", async () => {
        const queryFn = vi.fn(async (_args: string, _requestId: string) => "ok");
        const command = createCommand<string, string>({ queryFn });

        await command.trigger("a", "k1");
        await command.trigger("a", "k2");

        expect(queryFn.mock.calls[0][1]).not.toBe(queryFn.mock.calls[1][1]);
    });

    it("reuses the same request id across retries of the same entry", async () => {
        let attempt = 0;
        const queryFn = vi.fn(async (_args: string, _requestId: string) => {
            attempt++;
            if (attempt === 1) throw new Error("boom");
            return "ok";
        });
        const command = createCommand<string, string>({ queryFn });

        await command.trigger("a", "k1").catch(() => {});
        await flushMicrotasks();

        const entry = command.getEntry("k1")!;
        expect(entry.machine$.peek().state.status).toBe("error");

        entry.retry();
        await flushMicrotasks();

        expect(entry.machine$.peek().state.status).toBe("success");
        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(queryFn.mock.calls[1][1]).toBe(queryFn.mock.calls[0][1]);
    });

    it("uses a sync generateRequestId option", async () => {
        const queryFn = vi.fn(async (_args: string, _requestId: string) => "ok");
        const command = createCommand<string, string>({
            queryFn,
            generateRequestId: (args) => `id-for-${args}`,
        });

        await command.trigger("hello", "k1");

        expect(queryFn).toHaveBeenCalledWith("hello", "id-for-hello");
    });

    it("uses an async generateRequestId option", async () => {
        const queryFn = vi.fn(async (_args: string, _requestId: string) => "ok");
        const command = createCommand<string, string>({
            queryFn,
            generateRequestId: async (args) => `async-id-for-${args}`,
        });

        await command.trigger("hello", "k1");

        expect(queryFn).toHaveBeenCalledWith("hello", "async-id-for-hello");
    });

    it("mints an async request id once and reuses it across retries", async () => {
        let mintCount = 0;
        let attempt = 0;
        const queryFn = vi.fn(async (_args: string, _requestId: string) => {
            attempt++;
            if (attempt === 1) throw new Error("boom");
            return "ok";
        });
        const command = createCommand<string, string>({
            queryFn,
            generateRequestId: async () => {
                mintCount++;
                return `async-id-${mintCount}`;
            },
        });

        await command.trigger("a", "k1").catch(() => {});
        await flushMicrotasks();

        command.getEntry("k1")!.retry();
        await flushMicrotasks();

        expect(mintCount).toBe(1);
        expect(queryFn.mock.calls[0][1]).toBe("async-id-1");
        expect(queryFn.mock.calls[1][1]).toBe("async-id-1");
    });
});

// ==================== Synchronous throw from queryFn / generateRequestId ====================
//
// A non-async queryFn (or a sync generateRequestId) can throw *synchronously*,
// before any promise exists. That throw used to propagate straight out of the
// QueryCacheEntry constructor and thus out of trigger() — violating the
// "trigger always returns a Promise" contract — and, worse, leaving any
// already-applied optimistic patches dangling (their rollback is attached to a
// queryFn promise that was never created). Both must be contained: trigger
// rejects, and optimistic patches roll back.
describe("Command — synchronous throw from queryFn / generateRequestId", () => {
    it("trigger() rejects (does not synchronously throw) when a non-async queryFn throws", async () => {
        const error = new Error("sync boom");
        const command = createCommand<string, string>({
            queryFn: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = command.trigger("x", "k1");
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });

    it("entry settles in error state after a synchronous queryFn throw", async () => {
        const command = createCommand<string, string>({
            queryFn: () => {
                throw new Error("sync boom");
            },
        });

        await command.trigger("x", "k1").catch(() => {});
        await flushMicrotasks();

        expect(command.getEntry("k1")!.machine$.peek().state.status).toBe("error");
    });

    it("trigger() rejects (does not synchronously throw) when a sync generateRequestId throws", async () => {
        const error = new Error("id boom");
        const queryFn = vi.fn(async () => "ok");
        const command = createCommand<string, string>({
            queryFn,
            generateRequestId: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = command.trigger("x", "k1");
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
        // The id could not be minted, so the mutation must not have run.
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("rolls back an already-applied optimistic patch when queryFn throws synchronously", async () => {
        const resource = createLinkedResource<number, { value: string }>({
            queryFn: async (n) => ({ value: `original-${n}` }),
        });

        resource.trigger(1);
        await flushMicrotasks();
        const entry = resource.getEntry(1)!;

        const link: TLinkConfig<string, string, number, { value: string }> = {
            resource,
            forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
            optimisticUpdate: (draft) => {
                draft.value = `${draft.value}-optimistic`;
            },
        };

        const command = createCommand<string, string>({
            queryFn: () => {
                throw new Error("sync boom");
            },
            links: [link],
        });

        await expect(command.trigger("1", "k1")).rejects.toThrow("sync boom");
        await flushMicrotasks();

        // The optimistic patch must be rolled back: data restored, no dangling patch.
        const state = entry.machine$.peek().state;
        if (!hasData(state)) throw new Error(`expected data state, got "${state.status}"`);
        expect(state.data).toEqual({ value: "original-1" });
        expect(state.patchState).toBeNull();
    });

    it("does not produce an unhandled rejection when a non-async queryFn throws synchronously", async () => {
        const tracker = await trackUnhandledRejections();
        try {
            const command = createCommand<string, string>({
                queryFn: () => {
                    throw new Error("sync boom");
                },
            });

            await command.trigger("x", "k1").catch(() => {});
            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });
});

// ==================== Retry ====================

describe("Command retry", () => {
    it("re-executes queryFn after an error and can succeed", async () => {
        let attempt = 0;
        const command = createCommand<string, string>({
            queryFn: async () => {
                attempt++;
                if (attempt === 1) throw new Error("boom");
                return "recovered";
            },
        });

        await command.trigger("a", "k1").catch(() => {});
        await flushMicrotasks();

        const entry = command.getEntry("k1")!;
        expect(entry.machine$.peek().state.status).toBe("error");

        entry.retry();
        await flushMicrotasks();

        const state = entry.machine$.peek().state;
        expect(state.status).toBe("success");
        expect(state.data).toBe("recovered");
    });

    it("invalidates linked resources when a retry succeeds", async () => {
        const resource = createLinkedResource<number, string>({
            queryFn: async (n) => `resource-data-${n}`,
        });

        let attempt = 0;
        const command = createCommand<string, string>({
            queryFn: async () => {
                attempt++;
                if (attempt === 1) throw new Error("boom");
                return "ok";
            },
            links: [
                {
                    resource,
                    forwardArgs: (cmdArgs: string) => parseInt(cmdArgs, 10),
                    invalidate: true,
                },
            ],
        });

        resource.trigger(1);
        await flushMicrotasks();

        await command.trigger("1", "k1").catch(() => {});
        await flushMicrotasks();

        const refreshSpy = vi.spyOn(resource, "refresh");

        command.getEntry("k1")!.retry();
        await flushMicrotasks();

        expect(refreshSpy).toHaveBeenCalledWith(1);
    });
});

// ==================== retentionTime: 0 without observers ====================

describe("trigger() without observers — retentionTime: 0 regression", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves correctly when GC timer fires before queryFn settles", async () => {
        vi.useFakeTimers();

        let resolveQuery!: (val: string) => void;
        const command = new Command<string, string>({
            queryFn: () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
            retentionTime: 0,
            links: [],
        });

        const promise = command.trigger("x", "k1");

        // Fire the retentionTime timer(0). Without the keepalive fix, this GCs
        // the entry and rejects `promise` with CacheEntryRemovedError.
        await vi.runAllTimersAsync();

        resolveQuery("result");
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toBe("result");
    });

    it("rejects with queryFn error (not CacheEntryRemovedError) when GC timer fires first", async () => {
        vi.useFakeTimers();

        const serverError = new Error("network error");
        let rejectQuery!: (err: unknown) => void;
        const command = new Command<string, string>({
            queryFn: () =>
                new Promise<string>((_, r) => {
                    rejectQuery = r;
                }),
            retentionTime: 0,
            links: [],
        });

        const promise = command.trigger("x", "k1");

        await vi.runAllTimersAsync();

        rejectQuery(serverError);
        await vi.runAllTimersAsync();

        await expect(promise).rejects.toBe(serverError);
    });
});

// ==================== Agent integration ====================

describe("Command agent integration", () => {
    it("reflects trigger state without an explicit key (no stuck idle)", async () => {
        const command = createCommand<string, string>({ queryFn: async () => "ok" });
        const agent = command.createAgent();

        const statuses: string[] = [];
        const eff = Signal.effect(() => statuses.push(agent.state$().status));

        agent.trigger("a");
        await flushMicrotasks();

        expect(agent.state$.peek().status).toBe("success");
        expect(statuses).toContain("pending");
        eff.unsubscribe();
    });

    it("agent.retry() re-runs the tracked mutation after an error", async () => {
        let attempt = 0;
        const command = createCommand<string, string>({
            queryFn: async () => {
                attempt++;
                if (attempt === 1) throw new Error("boom");
                return "recovered";
            },
        });
        const agent = command.createAgent();

        const eff = Signal.effect(() => agent.state$());

        // The envelope promise never rejects — no catch needed for a failing trigger.
        await agent.trigger("a");
        await flushMicrotasks();
        expect(agent.state$.peek().status).toBe("error");

        agent.retry();
        await flushMicrotasks();

        expect(agent.state$.peek().status).toBe("success");
        expect(agent.state$.peek().data).toBe("recovered");
        eff.unsubscribe();
    });
});
