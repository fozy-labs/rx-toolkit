import { afterEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { Command } from "@/query/core/command/Command";
import type { ICommandForClutch } from "@/query/core/command/CommandClutch";
import { CommandClutch } from "@/query/core/command/CommandClutch";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import type { ICommandClutch, IQueryCacheEntry, TCommandClutchState, TLinkConfig, TMachineState } from "@/query/types";
import { Signal } from "@/signals/signals/Signal";

// ==================== Helpers ====================

/**
 * Create a minimal mock IQueryCacheEntry whose state$ is a controllable signal.
 */
function createMockEntry<TArgs, TData>(initialState: TMachineState<TArgs, TData>) {
    const machineSignal = Signal.state({ state: initialState } as any);
    return {
        entry: {
            state$: machineSignal as any,
            keyedArgs: { value: null, key: "k" } as any,
            machine$: machineSignal as any,
            completed$: { subscribe: vi.fn() } as any,
            peek: () => ({ state: initialState }),
            set: vi.fn(),
            complete: vi.fn(),
            invalidate: vi.fn(),
            retry: vi.fn(),
            createPatch: vi.fn(),
        } as unknown as IQueryCacheEntry<TArgs, TData>,
        setMachineState(state: TMachineState<TArgs, TData>) {
            machineSignal.set({ state } as any);
        },
    };
}

function pendingState<TArgs>(args: TArgs): TMachineState<TArgs, any> {
    return { status: "pending", args, data: null, error: null, updatedAt: null } as any;
}

/** A pending run started by `retry()`: the failure it retries travels with it. */
function retryingPendingState<TArgs>(args: TArgs, error: unknown): TMachineState<TArgs, any> {
    return { status: "pending", args, data: null, error, updatedAt: null } as any;
}

function successState<TArgs, TData>(args: TArgs, data: TData): TMachineState<TArgs, TData> {
    return { status: "success", args, data, error: null, updatedAt: Date.now(), patchState: null } as any;
}

function errorState<TArgs>(args: TArgs, error: unknown): TMachineState<TArgs, any> {
    return { status: "error", args, data: null, error, updatedAt: null } as any;
}

function invalidatingState<TArgs, TData>(args: TArgs, data: TData): TMachineState<TArgs, TData> {
    return { status: "invalidating", args, data, error: null, updatedAt: Date.now(), patchState: null } as any;
}

function invalidateErrorState<TArgs, TData>(args: TArgs, data: TData, error: unknown): TMachineState<TArgs, TData> {
    return { status: "invalidate-error", args, data, error, updatedAt: Date.now(), patchState: null } as any;
}

/** Create a mock ICommandForClutch. The entries map is keyed by cache-entry key. */
function createMockCommand<TArgs = string, TData = string>() {
    const entries = new Map<string, ReturnType<typeof createMockEntry<TArgs, TData>>>();
    let executeImpl: (args: any, entryKey?: string) => Promise<TData> = async () => "default" as any;

    const command: ICommandForClutch<TArgs, TData> = {
        execute: vi.fn((args, entryKey) => executeImpl(args, entryKey)),
        getEntry$: vi.fn((entryKey: string) => entries.get(entryKey)?.entry ?? null),
    };

    return {
        command,
        entries,
        addEntry(entryKey: string, initialState: TMachineState<TArgs, TData>) {
            const mock = createMockEntry<TArgs, TData>(initialState);
            entries.set(entryKey, mock);
            return mock;
        },
        setExecuteImpl(fn: (args: any, entryKey?: string) => Promise<TData>) {
            executeImpl = fn;
            (command.execute as any).mockImplementation(fn);
        },
    };
}

/** Every own field of a command clutch state except the `retry` method. */
interface ExpectedRow<TArgs, TData, TError> {
    status: TCommandClutchState<TArgs, TData, TError>["status"];
    hasData: boolean;
    hasError: boolean;
    data: TData | null;
    error: TError | null;
    args: TArgs | null;
    isPending: boolean;
}

/**
 * Assert the *complete* shape of a matrix row: `toEqual` fails on an extra
 * field, so a removed flag (`isLoading` / `isSuccess` / `isError`) coming back
 * breaks the test.
 */
function expectRow<TArgs, TData, TError>(
    actual: TCommandClutchState<TArgs, TData, TError>,
    expected: ExpectedRow<TArgs, TData, TError>,
): void {
    expect(actual).toEqual({ ...expected, retry: expect.any(Function) });
}

/** A promise whose settlement the test drives. */
function defer<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** `retentionTime: false` keeps the settled entry alive so retry / invalidate have a target. */
function makeCommand<TArgs, TData>(queryFn: (args: TArgs, requestId: string) => Promise<TData>) {
    return new Command<TArgs, TData>({ retentionTime: false, links: [], queryFn });
}

// Collect effects for cleanup
const _effects: Array<{ unsubscribe: () => void }> = [];

function observe<TArgs, TData>(clutch: ICommandClutch<TArgs, TData>) {
    let latest!: TCommandClutchState<TArgs, TData>;
    const eff = Signal.effect(() => {
        latest = clutch.state$();
    });
    _effects.push(eff);
    return { get: () => latest };
}

afterEach(() => {
    while (_effects.length) _effects.pop()!.unsubscribe();
    vi.restoreAllMocks();
});

// ==================== 1. State matrix rows K1–K5 ====================

// Rows of the command section of the state matrix. Each test pins the whole
// state shape, not only the flag under discussion.
describe("CommandClutch state matrix", () => {
    it("K1 — nothing triggered: idle with nothing to show", () => {
        const { command } = createMockCommand();
        const clutch = new CommandClutch(command);
        const s = observe(clutch);

        expectRow(s.get(), {
            status: "idle",
            hasData: false,
            hasError: false,
            data: null,
            error: null,
            args: null,
            isPending: false,
        });
    });

    it("K2 — running (first or repeated trigger): pending, no data, no error", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", pendingState("hello"));

        const clutch = new CommandClutch(mock.command, "k1");
        const s = observe(clutch);

        expectRow(s.get(), {
            status: "pending",
            hasData: false,
            hasError: false,
            data: null,
            error: null,
            args: "hello",
            isPending: true,
        });
    });

    it("K3 — success: data present, no error", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", successState("hello", "result"));

        const clutch = new CommandClutch(mock.command, "k1");
        const s = observe(clutch);

        expectRow(s.get(), {
            status: "success",
            hasData: true,
            hasError: false,
            data: "result",
            error: null,
            args: "hello",
            isPending: false,
        });
    });

    it("K4 — error: error present, no data", () => {
        const err = new Error("fail");
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", errorState("hello", err));

        const clutch = new CommandClutch(mock.command, "k1");
        const s = observe(clutch);

        expectRow(s.get(), {
            status: "error",
            hasData: false,
            hasError: true,
            data: null,
            error: err,
            args: "hello",
            isPending: false,
        });
    });

    it("K5 — retry of K4: pending that keeps the retried failure readable", () => {
        const err = new Error("fail");
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", retryingPendingState("hello", err));

        const clutch = new CommandClutch(mock.command, "k1");
        const s = observe(clutch);

        expectRow(s.get(), {
            status: "pending",
            hasData: false,
            hasError: true,
            data: null,
            error: err,
            args: "hello",
            isPending: true,
        });
    });
});

// ==================== 2. trigger → idle → pending → success ====================

describe("CommandClutch trigger success", () => {
    it("idle → pending → success", () => {
        const mock = createMockCommand<string, string>();
        const entryMock = mock.addEntry("k1", pendingState("hello"));

        mock.setExecuteImpl(async () => "result");

        const clutch = new CommandClutch(mock.command);
        const s = observe(clutch);

        expect(s.get().status).toBe("idle");

        // trigger with an explicit entry key
        clutch.trigger("hello", "k1");
        expect(s.get().status).toBe("pending");
        expect(s.get().isPending).toBe(true);
        expect(s.get().args).toBe("hello");

        // Simulate machine transitioning to success
        entryMock.setMachineState(successState("hello", "result"));
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("result");
        expect(s.get().hasData).toBe(true);
        expect(s.get().isPending).toBe(false);
    });
});

// ==================== 3. trigger → idle → pending → error ====================

describe("CommandClutch trigger error", () => {
    it("idle → pending → error", async () => {
        const mock = createMockCommand<string, string>();
        const entryMock = mock.addEntry("k1", pendingState("hello"));

        const err = new Error("fail");
        mock.setExecuteImpl(async () => {
            throw err;
        });

        const clutch = new CommandClutch(mock.command);
        const s = observe(clutch);

        expect(s.get().status).toBe("idle");

        const promise = clutch.trigger("hello", "k1");
        expect(s.get().status).toBe("pending");

        const result = await promise;
        expect(result.status).toBe("error");
        expect(result.error).toBe(err);

        // Simulate machine transitioning to error
        entryMock.setMachineState(errorState("hello", err));
        expect(s.get().status).toBe("error");
        expect(s.get().error).toBe(err);
        expect(s.get().hasError).toBe(true);
        expect(s.get().isPending).toBe(false);
    });
});

// ==================== 3b. Trigger result envelope ====================

describe("CommandClutch trigger envelope", () => {
    it("resolves with a success envelope", async () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", pendingState("hello"));
        mock.setExecuteImpl(async () => "result");

        const clutch = new CommandClutch(mock.command);

        const result = await clutch.trigger("hello", "k1");
        expect(result).toEqual({ status: "success", data: "result" });
        expect(result.error).toBeUndefined();
    });

    it("resolves with an error envelope instead of rejecting", async () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", pendingState("hello"));
        const err = new Error("fail");
        mock.setExecuteImpl(async () => {
            throw err;
        });

        const clutch = new CommandClutch(mock.command);

        // No try/catch — the envelope promise never rejects.
        const result = await clutch.trigger("hello", "k1");
        expect(result.status).toBe("error");
        expect(result.error).toBe(err);
        expect(result.data).toBeUndefined();
    });

    it("unwrap() resolves with the raw data", async () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", pendingState("hello"));
        mock.setExecuteImpl(async () => "result");

        const clutch = new CommandClutch(mock.command);

        await expect(clutch.trigger("hello", "k1").unwrap()).resolves.toBe("result");
    });

    it("unwrap() rejects with the raw error", async () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", pendingState("hello"));
        const err = new Error("fail");
        mock.setExecuteImpl(async () => {
            throw err;
        });

        const clutch = new CommandClutch(mock.command);

        await expect(clutch.trigger("hello", "k1").unwrap()).rejects.toBe(err);
    });

    it("wraps a synchronous execute throw into an error envelope", async () => {
        const mock = createMockCommand<string, string>();
        const err = new Error("sync boom");
        mock.setExecuteImpl(() => {
            throw err;
        });

        const clutch = new CommandClutch(mock.command);

        const result = await clutch.trigger("hello", "k1");
        expect(result.status).toBe("error");
        expect(result.error).toBe(err);
    });

    it("ignored failing trigger does not produce an unhandled rejection", async () => {
        // Keep this mock-based test even though useCommand.test.ts has an
        // end-to-end twin: a real Command pre-handles its promise internally
        // (currentResult's no-op catch), so this is the only test that fails
        // if CommandClutch.trigger stops wrapping — the sole contractual
        // guarantee at the clutch level.
        const tracker = await trackUnhandledRejections();
        try {
            const mock = createMockCommand<string, string>();
            mock.addEntry("k1", pendingState("hello"));
            mock.setExecuteImpl(async () => {
                throw new Error("ignored");
            });

            const clutch = new CommandClutch(mock.command);

            // Fire-and-forget: nobody attaches a handler to the returned promise.
            void clutch.trigger("hello", "k1");

            await flushUnhandledRejections();
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });
});

// ==================== 4. setEntryKey switches observed entry ====================

describe("CommandClutch setEntryKey", () => {
    it("switches observed entry, state$ updates", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", successState("a", "data-a"));
        mock.addEntry("k2", successState("b", "data-b"));

        const clutch = new CommandClutch(mock.command);
        const s = observe(clutch);

        clutch.setEntryKey("k1");
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-a");

        clutch.setEntryKey("k2");
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-b");
    });

    it("setEntryKey to a non-existing entry key → idle", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", successState("a", "data-a"));

        const clutch = new CommandClutch(mock.command);
        const s = observe(clutch);

        clutch.setEntryKey("k1");
        expect(s.get().status).toBe("success");

        clutch.setEntryKey("no-such-key");
        expect(s.get().status).toBe("idle");
    });

    it("the deprecated setKey alias forwards to setEntryKey", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", successState("a", "data-a"));

        const clutch = new CommandClutch(mock.command);
        const s = observe(clutch);

        const setEntryKeySpy = vi.spyOn(clutch, "setEntryKey");

        clutch.setKey("k1");

        expect(setEntryKeySpy).toHaveBeenCalledTimes(1);
        expect(setEntryKeySpy).toHaveBeenCalledWith("k1");
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-a");
    });
});

// ==================== 5. dispose ====================

describe("CommandClutch dispose", () => {
    it.skip("resets to idle and stops tracking (dispose not yet implemented)", () => {
        const mock = createMockCommand<string, string>();
        const entryMock = mock.addEntry("k1", successState("a", "data-a"));

        const clutch = new CommandClutch(mock.command);
        const statuses: string[] = [];
        const eff = Signal.effect(() => {
            statuses.push(clutch.state$().status);
        });
        _effects.push(eff);

        clutch.setEntryKey("k1");
        expect(statuses).toContain("success");

        // dispose() is not yet part of the public API
        if ("dispose" in clutch) (clutch as unknown as { dispose: () => void }).dispose();

        // After dispose, the derived state is destroyed — further entry changes should not propagate
        const countAfterDispose = statuses.length;
        entryMock.setMachineState(errorState("a", new Error("x")));
        expect(statuses.length).toBe(countAfterDispose);
    });
});

// ==================== 6. Unreachable machine statuses ====================

// A command entry never invalidates, so `invalidating` / `invalidate-error`
// cannot reach the clutch. That branch fails loudly instead of remapping into
// `pending` with stale data (which would break the `data: null` typing of the
// K2 / K5 rows). Only a hand-made entry can reach it.
describe("CommandClutch unreachable machine statuses", () => {
    it('throws on "invalidating" instead of remapping it to pending', () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", invalidatingState("a", "stale-data"));

        const clutch = new CommandClutch(mock.command);
        clutch.setEntryKey("k1");

        expect(() => clutch.state$()).toThrow(/invalidating/);
    });

    it('throws on "invalidate-error" instead of remapping it to pending', () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", invalidateErrorState("a", "stale-data", new Error("invalidate fail")));

        const clutch = new CommandClutch(mock.command);
        clutch.setEntryKey("k1");

        expect(() => clutch.state$()).toThrow(/invalidate-error/);
    });
});

// ==================== 7. Entry key switching — different entry keys update state$ ====================

describe("CommandClutch entry key switching", () => {
    it("switching entry keys reflects each entry's state independently", () => {
        const mock = createMockCommand<string, string>();
        const entryA = mock.addEntry("kA", successState("a", "data-A"));
        mock.addEntry("kB", pendingState("b"));

        const clutch = new CommandClutch(mock.command);
        const s = observe(clutch);

        clutch.setEntryKey("kA");
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-A");

        clutch.setEntryKey("kB");
        expect(s.get().status).toBe("pending");
        expect(s.get().data).toBeNull();

        // Switch back — kA may have changed in the meantime
        entryA.setMachineState(errorState("a", new Error("gone")));
        clutch.setEntryKey("kA");
        expect(s.get().status).toBe("error");
    });

    it("constructor entryKey parameter sets initial observed entry", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("init-key", successState("x", "init-data"));

        const clutch = new CommandClutch(mock.command, "init-key");
        const s = observe(clutch);

        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("init-data");
    });
});

// ==================== 8. retry ====================

describe("CommandClutch retry", () => {
    it("calls retry() on the tracked entry", () => {
        const mock = createMockCommand<string, string>();
        const entryMock = mock.addEntry("k1", errorState("a", new Error("x")));

        const clutch = new CommandClutch(mock.command);
        clutch.setEntryKey("k1");

        clutch.retry();

        expect(entryMock.entry.retry).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when no entry is tracked", () => {
        const mock = createMockCommand<string, string>();
        const clutch = new CommandClutch(mock.command);

        expect(() => clutch.retry()).not.toThrow();
    });

    it("exposes a callable retry in the derived state", () => {
        const mock = createMockCommand<string, string>();
        const entryMock = mock.addEntry("k1", errorState("a", new Error("x")));

        const clutch = new CommandClutch(mock.command);
        const s = observe(clutch);
        clutch.setEntryKey("k1");

        expect(s.get().hasError).toBe(true);
        expect(typeof s.get().retry).toBe("function");

        s.get().retry();
        expect(entryMock.entry.retry).toHaveBeenCalledTimes(1);
    });
});

// ==================== 9. Repeated trigger on the same entry key ====================

// `Command.execute` completes the previous entry and creates a fresh one under
// the same entry key, so a repeated trigger always restarts at K2: neither the
// data nor the error of the previous run leaks into the new pending state.
describe("CommandClutch repeated trigger", () => {
    it("after a success, a repeated trigger starts from K2 with no stale data", async () => {
        const command = makeCommand<string, string>(async (args) => args.toUpperCase());
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        await clutch.trigger("a", "k1");
        await flushMicrotasks();
        expect(s.get().data).toBe("A");

        void clutch.trigger("b", "k1");

        expectRow(s.get(), {
            status: "pending",
            hasData: false,
            hasError: false,
            data: null,
            error: null,
            args: "b",
            isPending: true,
        });

        await flushMicrotasks();
        expect(s.get().data).toBe("B");
    });

    it("after a failure, a repeated trigger starts from K2 with no stale error", async () => {
        const err = new Error("first boom");
        let attempt = 0;
        const command = makeCommand<string, string>(async (args) => {
            attempt += 1;
            if (attempt === 1) throw err;
            return args.toUpperCase();
        });
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        await clutch.trigger("a", "k1");
        await flushMicrotasks();
        expect(s.get().error).toBe(err);

        void clutch.trigger("b", "k1");

        expectRow(s.get(), {
            status: "pending",
            hasData: false,
            hasError: false,
            data: null,
            error: null,
            args: "b",
            isPending: true,
        });

        await flushMicrotasks();
        expect(s.get().status).toBe("success");
    });
});

// ==================== 10. retry over a real Command (K4 ↔ K5) ====================

describe("CommandClutch retry transitions", () => {
    it("K4 → K5 → K3: the retried failure stays readable until the retry succeeds", async () => {
        const err = new Error("boom");
        let attempt = 0;
        const command = makeCommand<string, string>(async (args) => {
            attempt += 1;
            if (attempt === 1) throw err;
            return args.toUpperCase();
        });
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        await clutch.trigger("a", "k1");
        await flushMicrotasks();

        // K4
        expectRow(s.get(), {
            status: "error",
            hasData: false,
            hasError: true,
            data: null,
            error: err,
            args: "a",
            isPending: false,
        });

        s.get().retry();

        // K5 — the failure being retried is still readable.
        expectRow(s.get(), {
            status: "pending",
            hasData: false,
            hasError: true,
            data: null,
            error: err,
            args: "a",
            isPending: true,
        });

        await flushMicrotasks();

        // K3
        expectRow(s.get(), {
            status: "success",
            hasData: true,
            hasError: false,
            data: "A",
            error: null,
            args: "a",
            isPending: false,
        });
    });

    it("K4 → K5 → K4: a failed retry lands back in the error row with the new failure", async () => {
        const first = new Error("boom-1");
        const second = new Error("boom-2");
        let attempt = 0;
        const command = makeCommand<string, string>(async () => {
            attempt += 1;
            throw attempt === 1 ? first : second;
        });
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        await clutch.trigger("a", "k1");
        await flushMicrotasks();
        expect(s.get().error).toBe(first);

        s.get().retry();
        expect(s.get().status).toBe("pending");
        expect(s.get().hasError).toBe(true);

        await flushMicrotasks();

        expectRow(s.get(), {
            status: "error",
            hasData: false,
            hasError: true,
            data: null,
            error: second,
            args: "a",
            isPending: false,
        });
    });
});

// ==================== 11. retry() outside the error row ====================

// Every call outside the drawn K4 → K5 edge is a `console.warn` + no-op; the
// warning comes from QueryCacheEntry.retry(), the clutch only forwards.
describe("CommandClutch retry outside the error row", () => {
    it("K1 — no entry: no throw, no warning, state unchanged", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const command = makeCommand<string, string>(async (args) => args);
        const clutch = command.createClutch();
        const s = observe(clutch);

        expect(() => s.get().retry()).not.toThrow();

        expect(warn).not.toHaveBeenCalled();
        expectRow(s.get(), {
            status: "idle",
            hasData: false,
            hasError: false,
            data: null,
            error: null,
            args: null,
            isPending: false,
        });
    });

    it("K2 — running: warns and leaves the pending row untouched", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const deferred = defer<string>();
        const command = makeCommand<string, string>(() => deferred.promise);
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        void clutch.trigger("a", "k1");
        expect(s.get().status).toBe("pending");

        s.get().retry();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("retry() called in invalid state: pending"));
        expectRow(s.get(), {
            status: "pending",
            hasData: false,
            hasError: false,
            data: null,
            error: null,
            args: "a",
            isPending: true,
        });

        deferred.resolve("A");
        await flushMicrotasks();
    });

    it("K3 — success: warns and leaves the success row untouched", async () => {
        const command = makeCommand<string, string>(async (args) => args.toUpperCase());
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        await clutch.trigger("a", "k1");
        await flushMicrotasks();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        s.get().retry();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("retry() called in invalid state: success"));
        expectRow(s.get(), {
            status: "success",
            hasData: true,
            hasError: false,
            data: "A",
            error: null,
            args: "a",
            isPending: false,
        });
    });

    it("K5 — a retry already in flight: warns and leaves the row untouched", async () => {
        const err = new Error("boom");
        const deferred = defer<string>();
        let attempt = 0;
        const command = makeCommand<string, string>(() => {
            attempt += 1;
            return attempt === 1 ? Promise.reject(err) : deferred.promise;
        });
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        await clutch.trigger("a", "k1");
        await flushMicrotasks();

        s.get().retry();
        expect(s.get().status).toBe("pending");

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        s.get().retry();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining("retry() called in invalid state: pending"));
        expectRow(s.get(), {
            status: "pending",
            hasData: false,
            hasError: true,
            data: null,
            error: err,
            args: "a",
            isPending: true,
        });

        deferred.resolve("A");
        await flushMicrotasks();
    });
});

// ==================== 12. invalidate() never applies to a command entry ====================

// The guarantee behind the unreachable `invalidating` / `invalidate-error`
// branch of _deriveState: QueryCacheEntry.invalidate() warns and no-ops on any
// entry created with errorSource: "command".
describe("CommandClutch invalidate() on a command entry", () => {
    it("K3 — invalidate() warns and leaves the success row untouched", async () => {
        const command = makeCommand<string, string>(async (args) => args.toUpperCase());
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        await clutch.trigger("a", "k1");
        await flushMicrotasks();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        command.getEntry("k1")!.invalidate();
        await flushMicrotasks();

        expect(warn).toHaveBeenCalled();
        expectRow(s.get(), {
            status: "success",
            hasData: true,
            hasError: false,
            data: "A",
            error: null,
            args: "a",
            isPending: false,
        });
    });

    it("K4 — invalidate() warns and leaves the error row untouched", async () => {
        const err = new Error("boom");
        const command = makeCommand<string, string>(async () => {
            throw err;
        });
        const clutch = command.createClutch("k1");
        const s = observe(clutch);

        await clutch.trigger("a", "k1");
        await flushMicrotasks();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        command.getEntry("k1")!.invalidate();
        await flushMicrotasks();

        expect(warn).toHaveBeenCalled();
        expectRow(s.get(), {
            status: "error",
            hasData: false,
            hasError: true,
            data: null,
            error: err,
            args: "a",
            isPending: false,
        });
    });
});

// ==================== 13. Real Command integration — entry teardown with retentionTime: 0 ====================

// Regression for the default `useCommand` path: with retentionTime: 0 the cache entry
// is torn down the instant the mutation settles, while the clutch's `state$` is still
// observing it. A synchronous reset (resetOnRefCountZero: true) used to clear the
// entry's replayed value mid-recompute, making `entry.state$()` throw "No value emitted"
// and breaking the React subscription. A deferred, cancellable reset (timer(0)) survives
// the clutch's momentary unsubscribe/resubscribe during dependency switching.
describe("CommandClutch + real Command (retentionTime: 0 teardown)", () => {
    function makeEphemeralCommand(queryFn: (args: number, requestId: string) => Promise<number>) {
        // retentionTime: 0 mirrors DEFAULT_COMMAND_RETENTION_TIME used by api.createCommand.
        return new Command<number, number>({ retentionTime: 0, links: [], queryFn });
    }

    it("trigger without an entry key: idle → pending → success without throwing", async () => {
        const command = makeEphemeralCommand(async (args) => {
            await Promise.resolve();
            return args;
        });
        const clutch = command.createClutch();

        const seen: string[] = [];
        const eff = Signal.effect(() => {
            seen.push(clutch.state$().status);
        });
        _effects.push(eff);

        // No entry key — mirrors pay(100): the clutch mints a random one internally.
        await clutch.trigger(100);
        await flushMicrotasks();

        expect(seen).toContain("pending");
        expect(seen).toContain("success");

        const final = clutch.state$();
        expect(final.status).toBe("success");
        expect(final.hasData).toBe(true);
        expect(final.data).toBe(100);
    });

    it("trigger without an entry key: idle → pending → error without throwing", async () => {
        const err = new Error("boom");
        const command = makeEphemeralCommand(async () => {
            await Promise.resolve();
            throw err;
        });
        const clutch = command.createClutch();

        const seen: string[] = [];
        const eff = Signal.effect(() => {
            seen.push(clutch.state$().status);
        });
        _effects.push(eff);

        const result = await clutch.trigger(100);
        expect(result.status).toBe("error");
        expect(result.error).toBe(err);
        await flushMicrotasks();

        expect(seen).toContain("pending");
        expect(seen).toContain("error");

        const final = clutch.state$();
        expect(final.status).toBe("error");
        expect(final.hasError).toBe(true);
        expect(final.error).toBe(err);
    });

    it("survives a second trigger after the first settles", async () => {
        const command = makeEphemeralCommand(async (args) => {
            await Promise.resolve();
            return args;
        });
        const clutch = command.createClutch();

        const eff = Signal.effect(() => {
            void clutch.state$();
        });
        _effects.push(eff);

        await clutch.trigger(1);
        await flushMicrotasks();
        expect(clutch.state$().data).toBe(1);

        await clutch.trigger(2);
        await flushMicrotasks();
        expect(clutch.state$().status).toBe("success");
        expect(clutch.state$().data).toBe(2);
    });
});

// ==================== 14. Real Command integration — throwing optimisticUpdate ====================

// A throwing optimisticUpdate used to bypass the machine entirely: the trigger
// envelope carried the error, but no cache entry was created, so the clutch's
// state$ (and useCommand) stayed idle — the failure was invisible to state
// observers. It must surface on the clutch like any other mutation failure.
describe("CommandClutch + real Command (throwing optimisticUpdate)", () => {
    it("clutch state reflects the error, not just the envelope", async () => {
        const resource = new Resource<number, { value: string }>({
            retentionTime: false,
            serializeArgs: stableStringify,
            queryFn: async (n) => ({ value: `original-${n}` }),
        });
        resource.trigger(1);
        await flushMicrotasks();

        const link: TLinkConfig<number, number, number, { value: string }> = {
            resource,
            forwardArgs: (cmdArgs) => cmdArgs,
            optimisticUpdate: () => {
                throw new Error("optimistic boom");
            },
        };

        const command = new Command<number, number>({
            retentionTime: 0,
            links: [link],
            queryFn: async (args) => args,
        });
        const clutch = command.createClutch();

        const seen: string[] = [];
        const eff = Signal.effect(() => {
            seen.push(clutch.state$().status);
        });
        _effects.push(eff);

        const result = await clutch.trigger(1);
        expect(result.status).toBe("error");
        if (result.status !== "error") throw new Error("expected error envelope");
        expect((result.error as Error).message).toBe("optimistic boom");
        await flushMicrotasks();

        expect(seen).toContain("error");

        const final = clutch.state$();
        expect(final.status).toBe("error");
        expect(final.hasError).toBe(true);
        expect((final.error as Error).message).toBe("optimistic boom");
    });
});
