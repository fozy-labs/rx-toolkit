import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MachineStateError } from "../core/errors";
import type { TDataState } from "../core/machine/machine-helpers";
import { MachineWithData } from "../core/machine/MachineWithData";

// ── Test subclass ──────────────────────────────────────────────────

class TestMachine<TArgs, TData> extends MachineWithData<TArgs, TData> {
    constructor(state: TDataState<TArgs, TData>) {
        super(state);
    }

    protected withState(state: TDataState<TArgs, TData>): this {
        return new TestMachine(state) as this;
    }
}

// ── Helpers ────────────────────────────────────────────────────────

type TestArgs = { id: number };
type TestData = { name: string; count: number };

const ARGS: TestArgs = { id: 1 };
const DATA: TestData = { name: "Alice", count: 10 };

function makeSuccess(): TestMachine<TestArgs, TestData> {
    return new TestMachine({
        status: "success",
        args: ARGS,
        data: DATA,
        error: null,
        updatedAt: 1000,
        patchState: null,
    });
}

function makeRefreshing(): TestMachine<TestArgs, TestData> {
    return new TestMachine({
        status: "refreshing",
        args: ARGS,
        data: DATA,
        error: null,
        updatedAt: 1000,
        patchState: null,
    });
}

function makeRefreshError(): TestMachine<TestArgs, TestData> {
    return new TestMachine({
        status: "refresh-error",
        args: ARGS,
        data: DATA,
        error: new Error("refresh-boom"),
        updatedAt: 1000,
        patchState: null,
    });
}

// ── Tests ──────────────────────────────────────────────────────────

describe("MachineWithData", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── Accessors ──────────────────────────────────────────────────

    describe("accessors", () => {
        it("exposes data from state", () => {
            const m = makeSuccess();
            expect(m.data).toEqual(DATA);
        });

        it("exposes updatedAt from state", () => {
            const m = makeSuccess();
            expect(m.updatedAt).toBe(1000);
        });

        it("exposes patchState (null when no patches)", () => {
            const m = makeSuccess();
            expect(m.patchState).toBeNull();
        });
    });

    // ── createPatch ────────────────────────────────────────────────

    describe("createPatch()", () => {
        it("applies optimistic update and returns handle", () => {
            const m = makeSuccess();
            const { machine, handle } = m.createPatch((d) => {
                d.count = 99;
            });

            expect(machine.data).toEqual({ name: "Alice", count: 99 });
            expect(machine.patchState).not.toBeNull();
            expect(machine.patchState!.patches).toHaveLength(1);
            expect(machine.patchState!.patches[0].status).toBe("pending");
            expect(handle).toBeDefined();
        });

        it("preserves original data in patchState", () => {
            const m = makeSuccess();
            const { machine } = m.createPatch((d) => {
                d.count = 99;
            });

            expect(machine.patchState!.originalData).toEqual(DATA);
        });

        it("preserves state status", () => {
            const m = makeSuccess();
            const { machine } = m.createPatch((d) => {
                d.count = 99;
            });
            expect(machine.state.status).toBe("success");
        });

        it("works on refreshing state", () => {
            const m = makeRefreshing();
            const { machine } = m.createPatch((d) => {
                d.count = 50;
            });

            expect(machine.state.status).toBe("refreshing");
            expect(machine.data).toEqual({ name: "Alice", count: 50 });
        });

        it("works on refresh-error state", () => {
            const m = makeRefreshError();
            const { machine } = m.createPatch((d) => {
                d.name = "Bob";
            });

            expect(machine.state.status).toBe("refresh-error");
            expect(machine.data).toEqual({ name: "Bob", count: 10 });
        });

        it("chains multiple patches", () => {
            const m = makeSuccess();
            const { machine: m2, handle: h1 } = m.createPatch((d) => {
                d.count = 20;
            });
            const { machine: m3, handle: h2 } = m2.createPatch((d) => {
                d.count = 30;
            });

            expect(m3.data).toEqual({ name: "Alice", count: 30 });
            expect(m3.patchState!.patches).toHaveLength(2);
            expect(m3.patchState!.originalData).toEqual(DATA);
            expect(h1).toBeDefined();
            expect(h2).toBeDefined();
        });

        it("does not mutate original machine", () => {
            const m = makeSuccess();
            m.createPatch((d) => {
                d.count = 99;
            });

            expect(m.data).toEqual(DATA);
            expect(m.patchState).toBeNull();
        });
    });

    // ── handle commit / abort ──────────────────────────────────────

    describe("handle.commit()", () => {
        it("marks patch as committed", () => {
            const m = makeSuccess();
            const { machine, handle } = m.createPatch((d) => {
                d.count = 99;
            });

            handle.commit();
            expect(machine.patchState!.patches[0].status).toBe("committed");
        });

        it("is idempotent after first call", () => {
            const { handle } = makeSuccess().createPatch((d) => {
                d.count = 1;
            });
            handle.commit();
            handle.abort(); // should be no-op
            // no throw = pass
        });
    });

    describe("handle.abort()", () => {
        it("marks patch as aborted", () => {
            const m = makeSuccess();
            const { machine, handle } = m.createPatch((d) => {
                d.count = 99;
            });

            handle.abort();
            expect(machine.patchState!.patches[0].status).toBe("aborted");
        });
    });

    // ── finishPatch ────────────────────────────────────────────────

    describe("finishPatch()", () => {
        it("resolves committed patch and clears patchState", () => {
            const m = makeSuccess();
            const { machine, handle } = m.createPatch((d) => {
                d.count = 99;
            });

            handle.commit();
            const finished = machine.finishPatch();

            expect(finished.data).toEqual({ name: "Alice", count: 99 });
            expect(finished.patchState).toBeNull();
        });

        it("reverts aborted patch and clears patchState", () => {
            const m = makeSuccess();
            const { machine, handle } = m.createPatch((d) => {
                d.count = 99;
            });

            handle.abort();
            const finished = machine.finishPatch();

            expect(finished.data).toEqual(DATA);
            expect(finished.patchState).toBeNull();
        });

        it("throws when no active patchState", () => {
            const m = makeSuccess();
            expect(() => m.finishPatch()).toThrow(MachineStateError);
        });

        it("preserves state status after finish", () => {
            const m = makeRefreshing();
            const { machine, handle } = m.createPatch((d) => {
                d.count = 42;
            });
            handle.commit();
            const finished = machine.finishPatch();
            expect(finished.state.status).toBe("refreshing");
        });
    });

    // ── finishAllPatches ───────────────────────────────────────────

    describe("finishAllPatches()", () => {
        it("resolves all committed patches", () => {
            const m = makeSuccess();
            const { machine: m2, handle: h1 } = m.createPatch((d) => {
                d.count = 20;
            });
            const { machine: m3, handle: h2 } = m2.createPatch((d) => {
                d.count = 30;
            });

            h1.commit();
            h2.commit();
            const finished = m3.finishAllPatches();

            expect(finished.data).toEqual({ name: "Alice", count: 30 });
            expect(finished.patchState).toBeNull();
        });

        it("processes committed past pending, keeps pending", () => {
            const m = makeSuccess();
            const { machine: m2, handle: h1 } = m.createPatch((d) => {
                d.count = 20;
            });
            h1.commit();
            const { machine: m3 } = m2.createPatch((d) => {
                d.count = 30;
            });
            // h2 left pending
            const { machine: m4, handle: h3 } = m3.createPatch((d) => {
                d.count = 40;
            });
            h3.commit();

            const finished = m4.finishAllPatches();

            // Both committed folded, only pending remains
            expect(finished.patchState).not.toBeNull();
            expect(finished.patchState!.patches.length).toBe(1);
            expect(finished.patchState!.patches[0].status).toBe("pending");
        });

        it("throws MachineStateError when no active patchState", () => {
            const m = makeSuccess();
            expect(() => m.finishAllPatches()).toThrow(MachineStateError);
        });
    });
});
