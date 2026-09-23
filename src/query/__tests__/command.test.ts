import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { Command } from "@/query/core/command/Command";
import { CacheEntryRemovedError } from "@/query/core/errors";
import { isDataState } from "@/query/core/machine/machine-helpers";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import { toKeyed } from "@/query/lib/toKeyed";
import type {
    ICommandConfig,
    IResourceConfig,
    TCommandClutchState,
    TCommandEntryIdleState,
    TCommandEntryState,
    TLinkConfig,
} from "@/query/types";
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

// ==================== execute ====================

describe("Command.execute", () => {
    it("calls queryFn with provided args and resolves with result", async () => {
        const queryFn = vi.fn(async (args: string) => `result-${args}`);
        const command = createCommand<string, string>({ queryFn });

        const result = await command.execute("hello", "k1");
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

        await expect(command.execute("x", "k1")).rejects.toBe(error);
    });

    it("auto-generates an entry key when none is provided", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "ok",
        });

        command.execute("a");
        // We can't predict the exact auto-generated entry key, but an entry should exist.
        // The entry-key format is `${Date.now()}-${counter}`.
        // After trigger, the entry is created. We'll verify via reset (which clears entries).
        await flushMicrotasks();
        // No assertion on the entry key needed — the test is that it doesn't throw
    });

    it("accepts an explicit entryKey parameter", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "ok",
        });

        command.execute("a", "my-key");
        await flushMicrotasks();

        const entry = command.getEntry("my-key");
        expect(entry).not.toBeNull();
    });

    it("replaces existing cache entry for the same entry key", async () => {
        let callCount = 0;
        const command = createCommand<string, string>({
            queryFn: async (args) => {
                callCount++;
                return `result-${callCount}`;
            },
        });

        command.execute("a", "k1");
        await flushMicrotasks();

        const entry1 = command.getEntry("k1");

        command.execute("b", "k1");
        await flushMicrotasks();

        const entry2 = command.getEntry("k1");
        expect(entry2).not.toBe(entry1);
        expect(entry2!.state$.peek().data).toBe("result-2");
    });

    it("calls complete() on existing entry when replacing with the same entry key", async () => {
        let resolveFirst!: (val: string) => void;
        const command = createCommand<string, string>({
            queryFn: async () =>
                new Promise<string>((r) => {
                    resolveFirst = r;
                }),
        });

        command.execute("a", "k1");
        const entry1 = command.getEntry("k1")!;

        let completed = false;
        entry1.completed$.subscribe(() => {
            completed = true;
        });

        // Trigger again with the same entry key — should complete the first entry
        const command2queryFn = vi.fn(async () => "second");
        // We need a new command or we just trigger again on the same
        command.execute("b", "k1");

        expect(completed).toBe(true);
    });

    it("creates a cache entry that is accessible via getEntry", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.execute("x", "k1");

        const entry = command.getEntry("k1");
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("pending");

        await flushMicrotasks();
        expect(entry!.state$.peek().status).toBe("success");
        expect(entry!.state$.peek().data).toBe("data");
    });

    it("entry transitions to error state when queryFn rejects", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => {
                throw new Error("fail");
            },
        });

        const promise = command.execute("x", "k1");
        await promise.catch(() => {});
        await flushMicrotasks();

        const entry = command.getEntry("k1");
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("error");
    });

    it("failed execute does not produce an unhandled rejection (no lifecycle hooks)", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const command = createCommand<string, string>({
                queryFn: async () => {
                    throw new Error("fail");
                },
            });

            await command.execute("x", "k1").catch(() => {});
            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });
});

// ==================== getEntry ====================

describe("Command.getEntry", () => {
    it("returns entry when the entry key exists", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.execute("x", "k1");
        await flushMicrotasks();

        expect(command.getEntry("k1")).not.toBeNull();
    });

    it("returns null when the entry key does not exist", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        expect(command.getEntry("nonexistent")).toBeNull();
    });

    it("returns null after entry has been completed and removed", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.execute("x", "k1");
        await flushMicrotasks();

        const entry = command.getEntry("k1")!;
        entry.complete();
        await flushMicrotasks();

        expect(command.getEntry("k1")).toBeNull();
    });
});

// ==================== getEntry$ (reactive) ====================

describe("Command.getEntry$", () => {
    it("returns entry when the entry key exists (same as getEntry)", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.execute("x", "k1");
        await flushMicrotasks();

        expect(command.getEntry$("k1")).not.toBeNull();
    });

    it("returns null when the entry key does not exist", () => {
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
        command.execute("x", "k1");
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

        command.execute("x", "k1");
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

        command.execute("x", "k1");
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

        command.execute("a", "k1");
        await flushMicrotasks();

        const firstEntry = entries[entries.length - 1];
        expect(firstEntry).not.toBeNull();

        command.execute("b", "k1");
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

        command.execute("a", "k1");
        command.execute("b", "k2"); // k2 is _lastEntry$, so k1 is the non-last entry
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

        command.execute("a", "k1");
        command.execute("b", "k2");
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

// ==================== createClutch ====================

describe("Command.createClutch", () => {
    it("returns a CommandClutch instance with expected methods", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        const clutch = command.createClutch();
        expect(clutch).toBeDefined();
        expect(typeof clutch.trigger).toBe("function");
        expect(typeof clutch.state$).toBe("function");
        expect(typeof clutch.setEntryKey).toBe("function");
    });

    it("accepts an optional entryKey parameter", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        const clutch = command.createClutch("my-key");
        expect(clutch).toBeDefined();
    });

    it("the deprecated createAgent alias forwards to createClutch", () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        const createClutchSpy = vi.spyOn(command, "createClutch");

        const clutch = command.createAgent("my-key");

        expect(createClutchSpy).toHaveBeenCalledTimes(1);
        expect(createClutchSpy).toHaveBeenCalledWith("my-key");
        expect(typeof clutch.setEntryKey).toBe("function");
    });
});

// ==================== bind ====================

describe("Command.bind", () => {
    it("returns an inert { kind, command, args, entryKey } descriptor", () => {
        const queryFn = vi.fn(async (s: string) => `result-${s}`);
        const command = createCommand<string, string>({ queryFn });

        const bound = command.bind("hello", "k1");

        expect(bound).toEqual({ kind: "command", command, args: "hello", entryKey: "k1" });
        // bind must not execute the mutation
        expect(queryFn).not.toHaveBeenCalled();
        expect(command.getEntry("k1")).toBeNull();
    });

    it("leaves entryKey undefined when omitted", () => {
        const command = createCommand<string, string>({
            queryFn: async (s) => `result-${s}`,
        });

        const bound = command.bind("hello");

        expect(bound.entryKey).toBeUndefined();
    });

    it("descriptor can be replayed via command.execute", async () => {
        const queryFn = vi.fn(async (s: string) => `result-${s}`);
        const command = createCommand<string, string>({ queryFn });

        const bound = command.bind("world", "k2");
        const result = await bound.command.execute(bound.args, bound.entryKey);

        expect(result).toBe("result-world");
        expect(queryFn).toHaveBeenCalledWith("world", expect.any(String));
    });

    it("the descriptor's entryKey is the entry key the mutation runs under", async () => {
        const command = createCommand<string, string>({
            queryFn: async (s) => `result-${s}`,
        });

        const bound = command.bind("world", "k3");
        await bound.command.execute(bound.args, bound.entryKey);

        expect(command.getEntry("k3")).not.toBeNull();
    });

    it("the deprecated pack alias forwards to bind", () => {
        const queryFn = vi.fn(async (s: string) => `result-${s}`);
        const command = createCommand<string, string>({ queryFn });

        const bindSpy = vi.spyOn(command, "bind");

        const bound = command.pack("hello", "k1");

        expect(bindSpy).toHaveBeenCalledTimes(1);
        expect(bindSpy).toHaveBeenCalledWith("hello", "k1");
        expect(bound).toEqual({ kind: "command", command, args: "hello", entryKey: "k1" });
        expect(queryFn).not.toHaveBeenCalled();
    });
});

// ==================== reset ====================

describe("Command.reset", () => {
    it("clears all cache entries", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => "data",
        });

        command.execute("a", "k1");
        command.execute("b", "k2");
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

        command.execute("a", "k1");
        command.execute("b", "k2");

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

        command.execute("a", "k1");
        await flushMicrotasks();
        expect(command.getEntry("k1")!.state$.peek().data).toBe("data-1");

        command.reset();

        command.execute("a", "k1");
        await flushMicrotasks();
        expect(command.getEntry("k1")!.state$.peek().data).toBe("data-2");
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
            let resourceCall = 0;
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `resource-data-${n}-v${++resourceCall}`,
            });
            const command = createCommand<string, string>({
                queryFn: async (args) => `cmd-result-${args}`,
                links: [{ resource, forwardArgs: (cmdArgs: string) => parseInt(cmdArgs, 10), invalidate: true }],
            });

            // Seed the resource cache
            resource.getEntry(1, true);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;
            entry.hold();
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: "resource-data-1-v1" });

            const settled = command.execute("1", "k1");
            await settled;

            // The held entry re-queried at once: the mutation's settle left it
            // invalidating, and the re-query brings fresh data.
            expect(resourceCall).toBe(2);
            await flushMicrotasks();
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: "resource-data-1-v2" });
        });

        it("marks a linked entry nobody holds; it re-queries on its next hold", async () => {
            let resourceCall = 0;
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `resource-data-${n}-v${++resourceCall}`,
            });
            const command = createCommand<string, string>({
                queryFn: async (args) => `cmd-result-${args}`,
                links: [{ resource, forwardArgs: (cmdArgs: string) => parseInt(cmdArgs, 10), invalidate: true }],
            });

            resource.getEntry(1, true);
            await flushMicrotasks();
            const entry = resource.getEntry(1)!;

            await command.execute("1", "k1");
            await flushMicrotasks();

            // Melting: only marked, data untouched, no request.
            expect(resourceCall).toBe(1);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: "resource-data-1-v1" });

            // The next hold — a component mounting — re-queries.
            const subscription = entry.obs.subscribe();
            expect(resourceCall).toBe(2);
            expect(entry.state$.peek().status).toBe("invalidating");

            await flushMicrotasks();
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: "resource-data-1-v2" });
            subscription.unsubscribe();
        });

        it("invalidates only the held linked entries at once; the others are marked", async () => {
            const resourceCalls: number[] = [];
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => {
                    resourceCalls.push(n);
                    return `resource-data-${n}`;
                },
            });
            const command = createCommand<string, string>({
                queryFn: async (args) => `cmd-result-${args}`,
                links: [
                    { resource, forwardArgs: () => 1, invalidate: true },
                    { resource, forwardArgs: () => 2, invalidate: true },
                ],
            });

            resource.getEntry(1, true);
            resource.getEntry(2, true);
            await flushMicrotasks();
            resourceCalls.length = 0;

            const held = resource.getEntry(1)!;
            const melting = resource.getEntry(2)!;
            held.hold();

            await command.execute("x", "k1");
            await flushMicrotasks();

            expect(resourceCalls).toEqual([1]);
            expect(held.isInvalidated).toBe(false);
            expect(melting.isInvalidated).toBe(true);
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

            resource.getEntry(1, true);
            await flushMicrotasks();

            const invalidateSpy = vi.spyOn(resource, "invalidate");

            await command.execute("1", "k1").catch(() => {});
            await flushMicrotasks();

            expect(invalidateSpy).not.toHaveBeenCalled();
        });

        /**
         * `invalidate` on a link, when the linked entry has a run in flight: the
         * link config's `inFlight` wins, otherwise the resource's
         * `invalidateInFlight` default (`cancel`) applies.
         */
        describe("with a run in flight on the linked entry", () => {
            function createInFlight(
                linkInvalidate: TLinkConfig<string, string, number, string>["invalidate"],
                resourceOverrides: Partial<Omit<IResourceConfig<number, string>, "queryFn">> = {},
            ) {
                const runs: { resolve: (v: string) => void; signal: AbortSignal }[] = [];
                const resource = createLinkedResource<number, string>({
                    ...resourceOverrides,
                    queryFn: (_n, signal) =>
                        new Promise<string>((resolve) => {
                            runs.push({ resolve, signal });
                        }),
                });
                const command = createCommand<string, string>({
                    queryFn: async (args) => `cmd-result-${args}`,
                    links: [
                        {
                            resource,
                            forwardArgs: (cmdArgs: string) => parseInt(cmdArgs, 10),
                            invalidate: linkInvalidate,
                        },
                    ],
                });

                // Held, as a mounted consumer would; the first run stays in flight.
                const entry = resource.getEntry(1, true);
                entry.hold();
                expect(runs).toHaveLength(1);

                return { command, resource, entry, runs };
            }

            it("invalidate: true — the resource default (cancel) aborts the run and starts another", async () => {
                const { command, entry, runs } = createInFlight(true);

                await command.execute("1", "k1");

                expect(runs).toHaveLength(2);
                expect(runs[0]!.signal.aborted).toBe(true);
                expect(entry.isInvalidated).toBe(false);
                expect(entry.state$.peek().status).toBe("pending");
            });

            it("invalidate: { inFlight: 'trail' } — the run settles, then the entry re-queries", async () => {
                const { command, entry, runs } = createInFlight({ inFlight: "trail" });

                await command.execute("1", "k1");

                expect(runs).toHaveLength(1);
                expect(runs[0]!.signal.aborted).toBe(false);
                expect(entry.isInvalidated).toBe(true);

                runs[0]!.resolve("before-mutation");
                await flushMicrotasks();

                // The pre-mutation data landed and is being re-checked right away.
                expect(runs).toHaveLength(2);
                expect(entry.isInvalidated).toBe(false);
                expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: "before-mutation" });

                runs[1]!.resolve("after-mutation");
                await flushMicrotasks();
                expect(entry.state$.peek()).toMatchObject({ status: "success", data: "after-mutation" });
            });

            it("invalidate: { inFlight: 'cancel' } overrides a resource whose default is trail", async () => {
                const { command, entry, runs } = createInFlight(
                    { inFlight: "cancel" },
                    { invalidateInFlight: "trail" },
                );

                await command.execute("1", "k1");

                expect(runs).toHaveLength(2);
                expect(runs[0]!.signal.aborted).toBe(true);
                expect(entry.isInvalidated).toBe(false);
            });

            it("invalidate: {} is the same as true — the resource default applies", async () => {
                const { command, entry, runs } = createInFlight({}, { invalidateInFlight: "trail" });

                await command.execute("1", "k1");

                expect(runs).toHaveLength(1);
                expect(runs[0]!.signal.aborted).toBe(false);
                expect(entry.isInvalidated).toBe(true);
            });

            it("invalidate: { inFlight: 'join' } — the run in flight is accepted as the answer", async () => {
                const { command, entry, runs } = createInFlight({ inFlight: "join" });

                await command.execute("1", "k1");

                expect(runs).toHaveLength(1);
                expect(runs[0]!.signal.aborted).toBe(false);
                expect(entry.isInvalidated).toBe(false);

                runs[0]!.resolve("before-mutation");
                await flushMicrotasks();

                // Nothing re-queries: the run started before the mutation stands.
                expect(runs).toHaveLength(1);
                expect(entry.state$.peek()).toMatchObject({ status: "success", data: "before-mutation" });
            });

            it("invalidate: true on a resource whose default is join — the run is left alone", async () => {
                const { command, entry, runs } = createInFlight(true, { invalidateInFlight: "join" });

                await command.execute("1", "k1");

                expect(runs).toHaveLength(1);
                expect(runs[0]!.signal.aborted).toBe(false);
                expect(entry.isInvalidated).toBe(false);
            });

            it("invalidate: false — nothing happens to the run", async () => {
                const { command, entry, runs } = createInFlight(false);

                await command.execute("1", "k1");

                expect(runs).toHaveLength(1);
                expect(runs[0]!.signal.aborted).toBe(false);
                expect(entry.isInvalidated).toBe(false);
            });
        });
    });

    describe("Optimistic patches", () => {
        it("applies optimistic patches before queryFn and commits on success", async () => {
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `original-${n}`,
            });

            // Seed the resource
            resource.getEntry(1, true);
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

            await command.execute("1", "k1");
            await flushMicrotasks();

            expect(optimisticSpy).toHaveBeenCalled();
        });

        it("rolls back optimistic patches on failure", async () => {
            const resource = createLinkedResource<number, string>({
                queryFn: async (n) => `original-${n}`,
            });

            // Seed the resource
            resource.getEntry(1, true);
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

            await command.execute("1", "k1").catch(() => {});
            await flushMicrotasks();

            // After rollback, data should be unchanged
            expect(entry.state$.peek().data).toBe("original-1");
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

            resourceA.getEntry(1, true);
            resourceB.getEntry(1, true);
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
            await expect(command.execute("1", "k1")).rejects.toThrow("optimistic boom");
            await flushMicrotasks();

            // The failure goes through the entry's state: the entry exists and holds the
            // error, so state observers (clutch / useCommand) see it too.
            const cmdEntry = command.getEntry("k1");
            expect(cmdEntry).not.toBeNull();
            const cmdState = cmdEntry!.state$.peek();
            expect(cmdState.status).toBe("error");
            if (cmdState.status !== "error") throw new Error("expected error state");
            expect((cmdState.error as Error).message).toBe("optimistic boom");

            // Resource A's already-applied optimistic patch must be rolled back:
            // data restored and no dangling pending patch left behind.
            const stateA = entryA.state$.peek();
            expect(stateA.data).toEqual({ value: "original-1" });
            if (!isDataState(stateA)) throw new Error(`Resource A: expected data state, got "${stateA.status}"`);
            expect(stateA.patchState).toBeNull();

            // Resource B is untouched (its patch never applied).
            const stateB = entryB.state$.peek();
            expect(stateB.data).toEqual({ value: "original-1" });
            if (!isDataState(stateB)) throw new Error(`Resource B: expected data state, got "${stateB.status}"`);
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

            resource.getEntry(1, true);
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

            await command.execute("1", "k1");
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

            resource.getEntry(1, true);
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

            await command.execute("1", "k1").catch(() => {});
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

                    patched.getEntry(1, true);
                    invalidated.getEntry(1, true);
                    await flushMicrotasks();

                    const patchedEntry = patched.getEntry(1)!;
                    const invalidateSpy = vi.spyOn(invalidated, "invalidate");

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
                    await expect(command.execute("1", "k1")).resolves.toBe("cmd-result");
                    await flushMicrotasks();
                    await flushUnhandledRejections();

                    // 1. Optimistic patch committed — not left dangling as a pending patch.
                    const state = patchedEntry.state$.peek();
                    if (!isDataState(state)) throw new Error(`expected data state, got "${state.status}"`);
                    expect(state.data).toEqual({ value: "original-1-optimistic" });
                    expect(state.patchState).toBeNull();

                    // 2. The independent resource is still invalidated.
                    expect(invalidateSpy).toHaveBeenCalledWith(1);

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

                    throwing.getEntry(1, true);
                    applied.getEntry(1, true);
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

                    await expect(command.execute("1", "k1")).resolves.toBe("done");
                    await flushMicrotasks();
                    await flushUnhandledRejections();

                    // The sibling link's update ran and committed despite the earlier throw.
                    const state = appliedEntry.state$.peek();
                    if (!isDataState(state)) throw new Error(`expected data state, got "${state.status}"`);
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

            resource.getEntry(1, true);
            await flushMicrotasks();

            const invalidateSpy = vi.spyOn(resource, "invalidate");

            const link: TLinkConfig<string, string, number, string> = {
                resource,
                forwardArgs: () => undefined as any,
                invalidate: true,
            };

            const command = createCommand<string, string>({
                queryFn: async () => "ok",
                links: [link],
            });

            await command.execute("1", "k1");
            await flushMicrotasks();

            // invalidate is called but with undefined — resource.invalidate(undefined) is a no-op
            // since there's no entry for undefined key
        });
    });

    describe("No links", () => {
        it("works fine without any links configured", async () => {
            const command = createCommand<string, string>({
                queryFn: async () => "result",
                links: [],
            });

            const result = await command.execute("x", "k1");
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

        command.execute("a", "k1");
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

        command.execute("x", "k1");
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

        command.execute("x", "k1");
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

        command.execute("x", "k1");
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
        command.execute("x", "k1");
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

        command.execute("a", "k1");
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

        command.execute("x", "k1");
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

        await command.execute("x", "k1").catch(() => {});
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

            await command.execute("x", "k1").catch(() => {});
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
        command.execute("x", "k1");
        await flushMicrotasks();

        expect(command.getEntry("k1")!.state$.peek().data).toBe("data");
    });

    it("fires for initial trigger (deferred after QCE constructor)", async () => {
        let firedCount = 0;

        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onQueryStarted: () => {
                firedCount++;
            },
        });

        command.execute("x", "k1");
        expect(firedCount).toBe(1);
    });
});

// ==================== Entry Key Generation ====================

describe("Entry key generation", () => {
    it("auto-generates unique entry keys for sequential triggers", async () => {
        const keys: string[] = [];
        const command = createCommand<string, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: (_args, ctx) => {
                keys.push(ctx.entry.keyedArgs.key);
            },
        });

        command.execute("a");
        command.execute("b");

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

        command.execute("a");
        command.execute("b");
        command.execute("c");

        // Entry keys should end with -0, -1, -2 respectively
        expect(keys[0]).toMatch(/-0$/);
        expect(keys[1]).toMatch(/-1$/);
        expect(keys[2]).toMatch(/-2$/);
    });
});

// ==================== Edge Cases ====================

describe("Edge cases", () => {
    it("rapid sequential triggers with the same entry key — only latest entry survives", async () => {
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

        command.execute("a", "k1");
        command.execute("b", "k1");
        command.execute("c", "k1");

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

        command.execute("x", "k1");

        const entry = command.getEntry("k1");
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("pending");
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

        command.execute("x", "k1");
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

        command.execute("first", "k1");
        const firstEntry = command.getEntry("k1")!;

        // Replace with new entry for the same entry key
        command.execute("second", "k1");
        await flushMicrotasks();

        const secondEntry = command.getEntry("k1")!;
        expect(secondEntry).not.toBe(firstEntry);

        // Resolve the first entry's queryFn — its completed$ fires,
        // but the cache should still hold the second entry
        resolveFirst("first-result");
        await flushMicrotasks();

        expect(command.getEntry("k1")).toBe(secondEntry);
    });

    it("concurrent executions with different entry keys are independent", async () => {
        let resolvers: Record<string, (val: string) => void> = {};

        const command = createCommand<string, string>({
            queryFn: async (args) =>
                new Promise<string>((r) => {
                    resolvers[args] = r;
                }),
        });

        const p1 = command.execute("a", "k1");
        const p2 = command.execute("b", "k2");

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
        resource.getEntry(1, true);
        await flushMicrotasks();
        const resourceEntry = resource.getEntry(1)!;
        expect(resourceEntry.state$.peek().data).toEqual({ value: "original-1" });

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
        const p1 = command.execute("1", "k1");
        const p2 = command.execute("1", "k2");

        // Both optimistic patches should have been applied synchronously
        const dataAfterOptimistic = resourceEntry.state$.peek().data;
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
        const finalData = resourceEntry.state$.peek().data as { value: string };
        expect(typeof finalData.value).toBe("string");
    });
});

// ==================== Edge Cases (MEDIUM priority) ====================

describe("Command — execute with pre-TKeyed args", () => {
    it("uses the custom entry key from the toKeyed wrapper", async () => {
        const command = createCommand<{ data: string }, string>({
            queryFn: async (args) => `result-${args.data}`,
        });

        const keyed = toKeyed({ data: "x" }, () => "custom-key");
        await command.execute(keyed);

        const entry = command.getEntry("custom-key");
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("success");
        expect(entry!.state$.peek().data).toBe("result-x");
    });
});

// ==================== Request id ====================

describe("Command request id", () => {
    it("passes an auto-generated string request id as the second arg to queryFn", async () => {
        const queryFn = vi.fn(async (_args: string, _requestId: string) => "ok");
        const command = createCommand<string, string>({ queryFn });

        await command.execute("a", "k1");

        const requestId = queryFn.mock.calls[0][1];
        expect(typeof requestId).toBe("string");
        expect(requestId.length).toBeGreaterThan(0);
    });

    it("mints a distinct request id for each fresh trigger", async () => {
        const queryFn = vi.fn(async (_args: string, _requestId: string) => "ok");
        const command = createCommand<string, string>({ queryFn });

        await command.execute("a", "k1");
        await command.execute("a", "k2");

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

        await command.execute("a", "k1").catch(() => {});
        await flushMicrotasks();

        const entry = command.getEntry("k1")!;
        expect(entry.state$.peek().status).toBe("error");

        entry.retry();
        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(queryFn.mock.calls[1][1]).toBe(queryFn.mock.calls[0][1]);
    });

    it("uses a sync generateRequestId option", async () => {
        const queryFn = vi.fn(async (_args: string, _requestId: string) => "ok");
        const command = createCommand<string, string>({
            queryFn,
            generateRequestId: (args) => `id-for-${args}`,
        });

        await command.execute("hello", "k1");

        expect(queryFn).toHaveBeenCalledWith("hello", "id-for-hello");
    });

    it("uses an async generateRequestId option", async () => {
        const queryFn = vi.fn(async (_args: string, _requestId: string) => "ok");
        const command = createCommand<string, string>({
            queryFn,
            generateRequestId: async (args) => `async-id-for-${args}`,
        });

        await command.execute("hello", "k1");

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

        await command.execute("a", "k1").catch(() => {});
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
// QueryCacheEntry constructor and thus out of execute() — violating the
// "execute always returns a Promise" contract — and, worse, leaving any
// already-applied optimistic patches dangling (their rollback is attached to a
// queryFn promise that was never created). Both must be contained: execute
// rejects, and optimistic patches roll back.
describe("Command — synchronous throw from queryFn / generateRequestId", () => {
    it("execute() rejects (does not synchronously throw) when a non-async queryFn throws", async () => {
        const error = new Error("sync boom");
        const command = createCommand<string, string>({
            queryFn: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = command.execute("x", "k1");
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });

    it("entry settles in error state after a synchronous queryFn throw", async () => {
        const command = createCommand<string, string>({
            queryFn: () => {
                throw new Error("sync boom");
            },
        });

        await command.execute("x", "k1").catch(() => {});
        await flushMicrotasks();

        expect(command.getEntry("k1")!.state$.peek().status).toBe("error");
    });

    it("execute() rejects (does not synchronously throw) when a sync generateRequestId throws", async () => {
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
            promise = command.execute("x", "k1");
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
        // The id could not be minted, so the mutation must not have run.
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("rolls back an already-applied optimistic patch when queryFn throws synchronously", async () => {
        const resource = createLinkedResource<number, { value: string }>({
            queryFn: async (n) => ({ value: `original-${n}` }),
        });

        resource.getEntry(1, true);
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

        await expect(command.execute("1", "k1")).rejects.toThrow("sync boom");
        await flushMicrotasks();

        // The optimistic patch must be rolled back: data restored, no dangling patch.
        const state = entry.state$.peek();
        if (!isDataState(state)) throw new Error(`expected data state, got "${state.status}"`);
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

            await command.execute("x", "k1").catch(() => {});
            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });
});

// ==================== Throwing optimisticUpdate goes through the entry state ====================
//
// A throwing optimisticUpdate used to be handled pre-flight: execute() rejected,
// but no cache entry was created — state observers (clutch / useCommand) never
// saw the failure, contradicting the "every failure enters the entry state"
// principle. Patches are now applied inside the entry's queryFn run, so the
// throw settles the entry in `error` like any other mutation failure.
describe("Command — throwing optimisticUpdate goes through the entry state", () => {
    function createThrowingOptimisticSetup(queryFn: (args: string, requestId: string) => Promise<string>) {
        const resource = createLinkedResource<number, { value: string }>({
            queryFn: async (n) => ({ value: `original-${n}` }),
        });

        const link: TLinkConfig<string, string, number, { value: string }> = {
            resource,
            forwardArgs: (cmdArgs) => parseInt(cmdArgs, 10),
            optimisticUpdate: () => {
                throw new Error("optimistic boom");
            },
        };

        const command = createCommand<string, string>({ queryFn, links: [link] });

        return { resource, command };
    }

    it("entry settles in error state; queryFn is not called", async () => {
        const queryFn = vi.fn(async () => "cmd-result");
        const { resource, command } = createThrowingOptimisticSetup(queryFn);

        resource.getEntry(1, true);
        await flushMicrotasks();

        await command.execute("1", "k1").catch(() => {});
        await flushMicrotasks();

        const state = command.getEntry("k1")!.state$.peek();
        expect(state.status).toBe("error");
        if (state.status !== "error") throw new Error("expected error state");
        expect((state.error as Error).message).toBe("optimistic boom");
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("retry() after the failure runs queryFn without re-applying optimistic patches", async () => {
        const queryFn = vi.fn(async () => "cmd-result");
        const { resource, command } = createThrowingOptimisticSetup(queryFn);

        resource.getEntry(1, true);
        await flushMicrotasks();
        const resourceEntry = resource.getEntry(1)!;

        await command.execute("1", "k1").catch(() => {});
        await flushMicrotasks();

        const cmdEntry = command.getEntry("k1")!;
        cmdEntry.retry();
        await flushMicrotasks();

        expect(cmdEntry.state$.peek().status).toBe("success");
        expect(queryFn).toHaveBeenCalledTimes(1);

        // The resource was never optimistically patched — and the retry must not
        // have tried to re-apply the throwing patch either.
        const resourceState = resourceEntry.state$.peek();
        if (!isDataState(resourceState)) throw new Error(`expected data state, got "${resourceState.status}"`);
        expect(resourceState.data).toEqual({ value: "original-1" });
        expect(resourceState.patchState).toBeNull();
    });

    it("does not produce an unhandled rejection", async () => {
        const tracker = await trackUnhandledRejections();
        try {
            const { resource, command } = createThrowingOptimisticSetup(async () => "cmd-result");

            resource.getEntry(1, true);
            await flushMicrotasks();

            await command.execute("1", "k1").catch(() => {});
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

        await command.execute("a", "k1").catch(() => {});
        await flushMicrotasks();

        const entry = command.getEntry("k1")!;
        expect(entry.state$.peek().status).toBe("error");

        entry.retry();
        await flushMicrotasks();

        const state = entry.state$.peek();
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

        resource.getEntry(1, true);
        await flushMicrotasks();

        await command.execute("1", "k1").catch(() => {});
        await flushMicrotasks();

        const invalidateSpy = vi.spyOn(resource, "invalidate");

        command.getEntry("k1")!.retry();
        await flushMicrotasks();

        expect(invalidateSpy).toHaveBeenCalledWith(1);
    });
});

// ==================== retentionTime: 0 without observers ====================

describe("execute() without observers — retentionTime: 0 regression", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("holds the entry until the mutation settles, then releases it", async () => {
        let resolveQuery!: (val: string) => void;
        const command = createCommand<string, string>({
            queryFn: () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        });

        const promise = command.execute("x", "k1");
        const entry = command.getEntry("k1")!;
        expect(entry.isMelting).toBe(false);

        resolveQuery("result");
        await promise;
        await flushMicrotasks();

        expect(entry.isMelting).toBe(true);
    });

    it("releases the hold on a failed mutation too", async () => {
        const command = createCommand<string, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        await expect(command.execute("x", "k1")).rejects.toThrow("boom");
        await flushMicrotasks();

        expect(command.getEntry("k1")!.isMelting).toBe(true);
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

        const promise = command.execute("x", "k1");

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

        const promise = command.execute("x", "k1");

        await vi.runAllTimersAsync();

        rejectQuery(serverError);
        await vi.runAllTimersAsync();

        await expect(promise).rejects.toBe(serverError);
    });
});

// ==================== Retention time as a function ====================

/**
 * What a command-level `retentionTime` function receives as `state`: the command
 * entry row — the clutch state without `retry()`. The entry exists whenever the
 * function runs, so the idle row is excluded.
 */
type TCommandRetentionState<TArgs, TData, TError = unknown> = Exclude<
    TCommandEntryState<TArgs, TData, TError>,
    TCommandEntryIdleState
>;

/**
 * `retentionTime` as a function of the mutation's args and its entry state. It
 * runs on the `active → retention` transition. The *first* evaluation always
 * finds the entry settled: `execute()` holds it alive until the mutation
 * resolves or rejects. A later run started by `retry()` carries no such
 * keepalive, so losing the last subscriber while a retry is in flight does hand
 * the policy a `pending` row.
 */
describe("Command retentionTime as a function", () => {
    it("the first evaluation sees the settled success state and the command's args", async () => {
        const seen: TCommandRetentionState<string, string>[] = [];
        const command = createCommand<string, string>({
            queryFn: async () => "ok",
            retentionTime: (_args: string, state: TCommandRetentionState<string, string>) => {
                seen.push(state);
                return false;
            },
        });

        await command.execute("a", "k1");
        await flushMicrotasks();

        expect(seen.map((state) => state.status)).toEqual(["success"]);
        expect(seen[0]).toMatchObject({
            status: "success",
            hasData: true,
            hasError: false,
            isPending: false,
            data: "ok",
            error: null,
            args: "a",
        });
        // The entry row carries no state methods.
        expect("retry" in seen[0]!).toBe(false);
    });

    it("the first evaluation sees the settled error state", async () => {
        const failure = new Error("boom");
        const seen: TCommandRetentionState<string, string>[] = [];
        const command = createCommand<string, string>({
            queryFn: async () => {
                throw failure;
            },
            retentionTime: (_args: string, state: TCommandRetentionState<string, string>) => {
                seen.push(state);
                return false;
            },
        });

        await expect(command.execute("a", "k1")).rejects.toBe(failure);
        await flushMicrotasks();

        expect(seen.map((state) => state.status)).toEqual(["error"]);
        expect(seen[0]).toMatchObject({
            status: "error",
            hasData: false,
            hasError: true,
            isPending: false,
            data: null,
            error: failure,
            args: "a",
        });
        expect("retry" in seen[0]!).toBe(false);
    });

    /**
     * Only `execute()` holds a keepalive, and only for the first run. A retry is
     * started through the entry, so dropping the last subscriber while it is in
     * flight is an ordinary `active → retention` transition — and the policy
     * does see a `pending` row, with `hasError` marking it as a retry. Pinned so
     * the narrower "the first evaluation is settled" contract stays honest.
     */
    it("a retry in flight hands the policy a pending row", async () => {
        const failure = new Error("boom");
        const seen: TCommandRetentionState<string, string>[] = [];
        let attempt = 0;
        let resolveRetry!: (value: string) => void;
        const command = createCommand<string, string>({
            queryFn: () => {
                attempt += 1;
                if (attempt === 1) return Promise.reject(failure);
                return new Promise<string>((resolve) => {
                    resolveRetry = resolve;
                });
            },
            retentionTime: (_args: string, state: TCommandRetentionState<string, string>) => {
                seen.push(state);
                return false;
            },
        });

        await expect(command.execute("a", "k1")).rejects.toBe(failure);
        await flushMicrotasks();

        // Cycle 1 — execute()'s keepalive released on the settled failure.
        expect(seen.map((state) => state.status)).toEqual(["error"]);

        const entry = command.getEntry("k1")!;
        const subscription = entry.obs.subscribe();
        entry.retry();
        await flushMicrotasks();
        expect(entry.peek().status).toBe("pending");

        // Cycle 2 — the retry is still running and nothing holds the entry.
        subscription.unsubscribe();

        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatchObject({
            status: "pending",
            isPending: true,
            hasData: false,
            data: null,
            hasError: true,
            error: failure,
            args: "a",
        });

        resolveRetry("ok");
        await flushMicrotasks();
    });

    /**
     * A read-only look at an in-flight entry is not a loss of subscribers, so it
     * must not evaluate the policy — that is what keeps the "first evaluation is
     * settled" contract a guarantee rather than an accident of timing.
     */
    it("a read-only look at an in-flight entry does not evaluate the function", async () => {
        const seen: TCommandRetentionState<string, string>[] = [];
        let resolveQuery!: (value: string) => void;
        const retentionTime = vi.fn((_args: string, state: TCommandRetentionState<string, string>) => {
            seen.push(state);
            return false as const;
        });
        const command = createCommand<string, string>({
            queryFn: () =>
                new Promise<string>((resolve) => {
                    resolveQuery = resolve;
                }),
            retentionTime,
        });

        const result = command.execute("a", "k1");
        await flushMicrotasks();

        // The mutation is still running; reading the entry must not count as a
        // retention cycle.
        const entry = command.getEntry("k1");
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("pending");
        expect(retentionTime).not.toHaveBeenCalled();

        resolveQuery("ok");
        await expect(result).resolves.toBe("ok");
        await flushMicrotasks();

        expect(seen.map((state) => state.status)).toEqual(["success"]);
    });

    /**
     * The two declarations must not drift: the clutch state is the entry row
     * plus `retry()`, so each is assignable to the other once `retry` is added.
     */
    it("TCommandClutchState is TCommandEntryState plus retry()", () => {
        expectTypeOf<TCommandClutchState<string, number, Error>>().toExtend<
            TCommandEntryState<string, number, Error> & { retry: () => void }
        >();
        expectTypeOf<TCommandEntryState<string, number, Error> & { retry: () => void }>().toExtend<
            TCommandClutchState<string, number, Error>
        >();
    });
});

// ==================== Clutch integration ====================

describe("Command clutch integration", () => {
    it("reflects trigger state without an explicit entry key (no stuck idle)", async () => {
        const command = createCommand<string, string>({ queryFn: async () => "ok" });
        const clutch = command.createClutch();

        const statuses: string[] = [];
        const eff = Signal.effect(() => statuses.push(clutch.state$().status));

        clutch.trigger("a");
        await flushMicrotasks();

        expect(clutch.state$.peek().status).toBe("success");
        expect(statuses).toContain("pending");
        eff.unsubscribe();
    });

    it("clutch.retry() re-runs the tracked mutation after an error", async () => {
        let attempt = 0;
        const command = createCommand<string, string>({
            queryFn: async () => {
                attempt++;
                if (attempt === 1) throw new Error("boom");
                return "recovered";
            },
        });
        const clutch = command.createClutch();

        const eff = Signal.effect(() => clutch.state$());

        // The envelope promise never rejects — no catch needed for a failing trigger.
        await clutch.trigger("a");
        await flushMicrotasks();
        expect(clutch.state$.peek().status).toBe("error");

        clutch.retry();
        await flushMicrotasks();

        expect(clutch.state$.peek().status).toBe("success");
        expect(clutch.state$.peek().data).toBe("recovered");
        eff.unsubscribe();
    });
});
