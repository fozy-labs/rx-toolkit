import { afterEach, describe, expect, it, vi } from "vitest";

import type { ICommandForAgent } from "@/query/core/command/CommandAgent";
import { CommandAgent } from "@/query/core/command/CommandAgent";
import type { IQueryCacheEntry, TCommandAgentState, TMachineState } from "@/query/types";
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
            refresh: vi.fn(),
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

function successState<TArgs, TData>(args: TArgs, data: TData): TMachineState<TArgs, TData> {
    return { status: "success", args, data, error: null, updatedAt: Date.now(), patchState: null } as any;
}

function errorState<TArgs>(args: TArgs, error: unknown): TMachineState<TArgs, any> {
    return { status: "error", args, data: null, error, updatedAt: null } as any;
}

function refreshingState<TArgs, TData>(args: TArgs, data: TData): TMachineState<TArgs, TData> {
    return { status: "refreshing", args, data, error: null, updatedAt: Date.now(), patchState: null } as any;
}

function refreshErrorState<TArgs, TData>(args: TArgs, data: TData, error: unknown): TMachineState<TArgs, TData> {
    return { status: "refresh-error", args, data, error, updatedAt: Date.now(), patchState: null } as any;
}

/** Create a mock ICommandForAgent. entries map keyed by key string. */
function createMockCommand<TArgs = string, TData = string>() {
    const entries = new Map<string, ReturnType<typeof createMockEntry<TArgs, TData>>>();
    let triggerImpl: (args: any, key?: string) => Promise<TData> = async () => "default" as any;

    const command: ICommandForAgent<TArgs, TData> = {
        trigger: vi.fn((args, key) => triggerImpl(args, key)),
        getEntry$: vi.fn((key: string) => entries.get(key)?.entry ?? null),
    };

    return {
        command,
        entries,
        addEntry(key: string, initialState: TMachineState<TArgs, TData>) {
            const mock = createMockEntry<TArgs, TData>(initialState);
            entries.set(key, mock);
            return mock;
        },
        setTriggerImpl(fn: (args: any, key?: string) => Promise<TData>) {
            triggerImpl = fn;
            (command.trigger as any).mockImplementation(fn);
        },
    };
}

// Collect effects for cleanup
const _effects: Array<{ unsubscribe: () => void }> = [];

function observe<TArgs, TData>(agent: CommandAgent<TArgs, TData>) {
    let latest!: TCommandAgentState<TArgs, TData>;
    const eff = Signal.effect(() => {
        latest = agent.state$();
    });
    _effects.push(eff);
    return { get: () => latest };
}

afterEach(() => {
    while (_effects.length) _effects.pop()!.unsubscribe();
});

// ==================== 1. Initial idle state ====================

describe("CommandAgent initial state", () => {
    it("state$() returns idle state initially", () => {
        const { command } = createMockCommand();
        const agent = new CommandAgent(command);
        const s = observe(agent);

        const st = s.get();
        expect(st.status).toBe("idle");
        expect(st.data).toBeNull();
        expect(st.error).toBeNull();
        expect(st.args).toBeNull();
        expect(st.isLoading).toBe(false);
        expect(st.isSuccess).toBe(false);
        expect(st.isError).toBe(false);
    });
});

// ==================== 2. trigger → idle → pending → success ====================

describe("CommandAgent trigger success", () => {
    it("idle → pending → success", () => {
        const mock = createMockCommand<string, string>();
        const entryMock = mock.addEntry("k1", pendingState("hello"));

        mock.setTriggerImpl(async () => "result");

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        expect(s.get().status).toBe("idle");

        // trigger with key
        agent.trigger("hello", "k1");
        expect(s.get().status).toBe("pending");
        expect(s.get().isLoading).toBe(true);
        expect(s.get().args).toBe("hello");

        // Simulate machine transitioning to success
        entryMock.setMachineState(successState("hello", "result"));
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("result");
        expect(s.get().isSuccess).toBe(true);
        expect(s.get().isLoading).toBe(false);
    });
});

// ==================== 3. trigger → idle → pending → error ====================

describe("CommandAgent trigger error", () => {
    it("idle → pending → error", async () => {
        const mock = createMockCommand<string, string>();
        const entryMock = mock.addEntry("k1", pendingState("hello"));

        const err = new Error("fail");
        mock.setTriggerImpl(async () => {
            throw err;
        });

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        expect(s.get().status).toBe("idle");

        const promise = agent.trigger("hello", "k1");
        expect(s.get().status).toBe("pending");

        await expect(promise).rejects.toThrow("fail");

        // Simulate machine transitioning to error
        entryMock.setMachineState(errorState("hello", err));
        expect(s.get().status).toBe("error");
        expect(s.get().error).toBe(err);
        expect(s.get().isError).toBe(true);
        expect(s.get().isLoading).toBe(false);
    });
});

// ==================== 4. setKey switches observed entry ====================

describe("CommandAgent setKey", () => {
    it("switches observed entry, state$ updates", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", successState("a", "data-a"));
        mock.addEntry("k2", successState("b", "data-b"));

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        agent.setKey("k1");
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-a");

        agent.setKey("k2");
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-b");
    });

    it("setKey to non-existing key → idle", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", successState("a", "data-a"));

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        agent.setKey("k1");
        expect(s.get().status).toBe("success");

        agent.setKey("no-such-key");
        expect(s.get().status).toBe("idle");
    });
});

// ==================== 5. dispose ====================

describe("CommandAgent dispose", () => {
    it.skip("resets to idle and stops tracking (dispose not yet implemented)", () => {
        const mock = createMockCommand<string, string>();
        const entryMock = mock.addEntry("k1", successState("a", "data-a"));

        const agent = new CommandAgent(mock.command);
        const statuses: string[] = [];
        const eff = Signal.effect(() => {
            statuses.push(agent.state$().status);
        });
        _effects.push(eff);

        agent.setKey("k1");
        expect(statuses).toContain("success");

        // dispose() is not yet part of the public API
        if ("dispose" in agent) (agent as unknown as { dispose: () => void }).dispose();

        // After dispose, _agentState$ is destroyed — further entry changes should not propagate
        const countAfterDispose = statuses.length;
        entryMock.setMachineState(errorState("a", new Error("x")));
        expect(statuses.length).toBe(countAfterDispose);
    });
});

// ==================== 6. Status remapping ====================

describe("CommandAgent status remapping", () => {
    it('"refreshing" is remapped to "pending"', () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", refreshingState("a", "stale-data"));

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        agent.setKey("k1");
        expect(s.get().status).toBe("pending");
        expect(s.get().isLoading).toBe(true);
        // Data from the refreshing state is still carried through
        expect(s.get().data).toBe("stale-data");
    });

    it('"refresh-error" is remapped to "pending"', () => {
        const mock = createMockCommand<string, string>();
        const err = new Error("refresh fail");
        mock.addEntry("k1", refreshErrorState("a", "stale-data", err));

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        agent.setKey("k1");
        expect(s.get().status).toBe("pending");
        expect(s.get().isLoading).toBe(true);
    });
});

// ==================== 7. Derived flags ====================

describe("CommandAgent derived flags", () => {
    it("isLoading is true only when status is pending", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", pendingState("a"));

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        agent.setKey("k1");
        expect(s.get().isLoading).toBe(true);
        expect(s.get().isSuccess).toBe(false);
        expect(s.get().isError).toBe(false);
    });

    it("isSuccess is true only when status is success", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", successState("a", "data"));

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        agent.setKey("k1");
        expect(s.get().isSuccess).toBe(true);
        expect(s.get().isLoading).toBe(false);
        expect(s.get().isError).toBe(false);
    });

    it("isError is true only when status is error", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("k1", errorState("a", new Error("x")));

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        agent.setKey("k1");
        expect(s.get().isError).toBe(true);
        expect(s.get().isLoading).toBe(false);
        expect(s.get().isSuccess).toBe(false);
    });
});

// ==================== 8. Key switching — different keys update state$ ====================

describe("CommandAgent key switching", () => {
    it("switching keys reflects each entry's state independently", () => {
        const mock = createMockCommand<string, string>();
        const entryA = mock.addEntry("kA", successState("a", "data-A"));
        mock.addEntry("kB", pendingState("b"));

        const agent = new CommandAgent(mock.command);
        const s = observe(agent);

        agent.setKey("kA");
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-A");

        agent.setKey("kB");
        expect(s.get().status).toBe("pending");
        expect(s.get().data).toBeNull();

        // Switch back — kA may have changed in the meantime
        entryA.setMachineState(errorState("a", new Error("gone")));
        agent.setKey("kA");
        expect(s.get().status).toBe("error");
    });

    it("constructor key parameter sets initial observed entry", () => {
        const mock = createMockCommand<string, string>();
        mock.addEntry("init-key", successState("x", "init-data"));

        const agent = new CommandAgent(mock.command, "init-key");
        const s = observe(agent);

        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("init-data");
    });
});
