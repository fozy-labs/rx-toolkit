import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MachineError } from "../core/machine/MachineError";
import { MachinePending } from "../core/machine/MachinePending";
import { MachineRefreshError } from "../core/machine/MachineRefreshError";
import { MachineRefreshing } from "../core/machine/MachineRefreshing";
import { MachineSuccess } from "../core/machine/MachineSuccess";
import { MachineWithData } from "../core/machine/MachineWithData";

// ── Helpers ────────────────────────────────────────────────────────

type TestArgs = { id: number };
type TestData = { name: string; count: number };

const ARGS: TestArgs = { id: 1 };
const DATA: TestData = { name: "Alice", count: 10 };
const DATA2: TestData = { name: "Bob", count: 20 };

function makePending() {
    return new MachinePending<TestArgs, TestData>({
        status: "pending",
        args: ARGS,
        data: null,
        error: null,
        updatedAt: null,
    });
}

function makeSuccess() {
    return new MachineSuccess<TestArgs, TestData>({
        status: "success",
        args: ARGS,
        data: DATA,
        error: null,
        updatedAt: 1000,
        patchState: null,
    });
}

function makeError() {
    return new MachineError<TestArgs, TestData>({
        status: "error",
        args: ARGS,
        data: null,
        error: new Error("boom"),
        updatedAt: null,
    });
}

function makeRefreshing() {
    return new MachineRefreshing<TestArgs, TestData>({
        status: "refreshing",
        args: ARGS,
        data: DATA,
        error: null,
        updatedAt: 1000,
        patchState: null,
    });
}

function makeRefreshError() {
    return new MachineRefreshError<TestArgs, TestData>({
        status: "refresh-error",
        args: ARGS,
        data: DATA,
        error: new Error("refresh-boom"),
        updatedAt: 1000,
        patchState: null,
    });
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Machine Subtypes", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── MachinePending ─────────────────────────────────────────────

    describe("MachinePending", () => {
        it("has status 'pending' and correct state shape", () => {
            const m = makePending();
            expect(m.status).toBe("pending");
            expect(m.state.status).toBe("pending");
            expect(m.state.args).toBe(ARGS);
            expect(m.state.data).toBeNull();
            expect(m.state.error).toBeNull();
            expect(m.state.updatedAt).toBeNull();
        });

        it("success() returns MachineSuccess with data", () => {
            const m = makePending().success(DATA);
            expect(m).toBeInstanceOf(MachineSuccess);
            expect(m.status).toBe("success");
            expect(m.state.status).toBe("success");
            expect(m.state.data).toBe(DATA);
            expect(m.state.error).toBeNull();
            expect(m.state.updatedAt).toBe(1000);
            expect(m.state.patchState).toBeNull();
        });

        it("fail() returns MachineError with error", () => {
            const err = new Error("boom");
            const m = makePending().fail(err);
            expect(m).toBeInstanceOf(MachineError);
            expect(m.status).toBe("error");
            expect(m.state.status).toBe("error");
            expect(m.state.error).toBe(err);
            expect(m.state.data).toBeNull();
        });

        it("is not an instance of MachineWithData", () => {
            const m = makePending();
            expect(m).not.toBeInstanceOf(MachineWithData);
        });
    });

    // ── MachineSuccess ─────────────────────────────────────────────

    describe("MachineSuccess", () => {
        it("has status 'success' and correct state shape", () => {
            const m = makeSuccess();
            expect(m.status).toBe("success");
            expect(m.state.status).toBe("success");
            expect(m.state.data).toBe(DATA);
            expect(m.state.args).toBe(ARGS);
            expect(m.state.updatedAt).toBe(1000);
            expect(m.state.patchState).toBeNull();
        });

        it("extends MachineWithData", () => {
            expect(makeSuccess()).toBeInstanceOf(MachineWithData);
        });

        it("has data/updatedAt getters from MachineWithData", () => {
            const m = makeSuccess();
            expect(m.data).toBe(DATA);
            expect(m.updatedAt).toBe(1000);
            expect(m.patchState).toBeNull();
        });

        it("refresh() returns MachineRefreshing", () => {
            const m = makeSuccess().refresh();
            expect(m).toBeInstanceOf(MachineRefreshing);
            expect(m.status).toBe("refreshing");
            expect(m.state.data).toBe(DATA);
            expect(m.state.args).toBe(ARGS);
        });

        it("createPatch() returns MachineSuccess with patch state", () => {
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            expect(machine).toBeInstanceOf(MachineSuccess);
            expect(machine.status).toBe("success");
            expect(machine.state.data.count).toBe(99);
            expect(machine.state.patchState).not.toBeNull();
            handle.abort();
        });

        it("finishPatch() returns MachineSuccess", () => {
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            handle.commit();
            const finished = machine.finishPatch();
            expect(finished).toBeInstanceOf(MachineSuccess);
            expect(finished.status).toBe("success");
        });

        it("finishAllPatches() returns MachineSuccess", () => {
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            handle.commit();
            const finished = machine.finishAllPatches();
            expect(finished).toBeInstanceOf(MachineSuccess);
            expect(finished.status).toBe("success");
        });
    });

    // ── MachineError ───────────────────────────────────────────────

    describe("MachineError", () => {
        it("has status 'error' and correct state shape", () => {
            const m = makeError();
            expect(m.status).toBe("error");
            expect(m.state.status).toBe("error");
            expect(m.state.error).toBeInstanceOf(Error);
            expect(m.state.data).toBeNull();
            expect(m.state.updatedAt).toBeNull();
        });

        it("is not an instance of MachineWithData", () => {
            expect(makeError()).not.toBeInstanceOf(MachineWithData);
        });

        it("retry() returns MachinePending", () => {
            const m = makeError().retry();
            expect(m).toBeInstanceOf(MachinePending);
            expect(m.status).toBe("pending");
            expect(m.state.args).toBe(ARGS);
            expect(m.state.data).toBeNull();
            expect(m.state.error).toBeNull();
        });
    });

    // ── MachineRefreshing ──────────────────────────────────────────

    describe("MachineRefreshing", () => {
        it("has status 'refreshing' and correct state shape", () => {
            const m = makeRefreshing();
            expect(m.status).toBe("refreshing");
            expect(m.state.status).toBe("refreshing");
            expect(m.state.data).toBe(DATA);
            expect(m.state.args).toBe(ARGS);
            expect(m.state.updatedAt).toBe(1000);
        });

        it("extends MachineWithData", () => {
            expect(makeRefreshing()).toBeInstanceOf(MachineWithData);
        });

        it("rebase() without patches returns MachineSuccess", () => {
            const m = makeRefreshing().rebase(DATA2);
            expect(m).toBeInstanceOf(MachineSuccess);
            expect(m.status).toBe("success");
            expect(m.state.data).toBe(DATA2);
            expect(m.state.updatedAt).toBe(1000);
        });

        it("rebase() with committed patches replays onto new base", () => {
            const { machine, handle } = makeRefreshing().createPatch((d) => {
                d.count = 99;
            });
            handle.commit();
            const rebased = machine.rebase(DATA2);
            expect(rebased).toBeInstanceOf(MachineSuccess);
            expect(rebased.status).toBe("success");
            // Patch replayed: count should be 99 on the new base
            expect(rebased.state.data.count).toBe(99);
        });

        it("fail() returns MachineRefreshError", () => {
            const err = new Error("refresh-fail");
            const m = makeRefreshing().fail(err);
            expect(m).toBeInstanceOf(MachineRefreshError);
            expect(m.status).toBe("refresh-error");
            expect(m.state.error).toBe(err);
            expect(m.state.data).toBe(DATA);
        });

        it("createPatch() returns MachineRefreshing", () => {
            const { machine, handle } = makeRefreshing().createPatch((d) => {
                d.count = 50;
            });
            expect(machine).toBeInstanceOf(MachineRefreshing);
            expect(machine.status).toBe("refreshing");
            expect(machine.state.data.count).toBe(50);
            handle.abort();
        });

        it("finishPatch() returns MachineRefreshing", () => {
            const { machine, handle } = makeRefreshing().createPatch((d) => {
                d.count = 50;
            });
            handle.commit();
            const finished = machine.finishPatch();
            expect(finished).toBeInstanceOf(MachineRefreshing);
            expect(finished.status).toBe("refreshing");
        });
    });

    // ── MachineRefreshError ────────────────────────────────────────

    describe("MachineRefreshError", () => {
        it("has status 'refresh-error' and correct state shape", () => {
            const m = makeRefreshError();
            expect(m.status).toBe("refresh-error");
            expect(m.state.status).toBe("refresh-error");
            expect(m.state.data).toBe(DATA);
            expect(m.state.error).toBeInstanceOf(Error);
            expect(m.state.updatedAt).toBe(1000);
        });

        it("extends MachineWithData", () => {
            expect(makeRefreshError()).toBeInstanceOf(MachineWithData);
        });

        it("refresh() returns MachineRefreshing", () => {
            const m = makeRefreshError().refresh();
            expect(m).toBeInstanceOf(MachineRefreshing);
            expect(m.status).toBe("refreshing");
            expect(m.state.data).toBe(DATA);
            expect(m.state.error).toBeNull();
        });

        it("createPatch() returns MachineRefreshError", () => {
            const { machine, handle } = makeRefreshError().createPatch((d) => {
                d.count = 77;
            });
            expect(machine).toBeInstanceOf(MachineRefreshError);
            expect(machine.status).toBe("refresh-error");
            expect(machine.state.data.count).toBe(77);
            handle.abort();
        });

        it("finishPatch() returns MachineRefreshError", () => {
            const { machine, handle } = makeRefreshError().createPatch((d) => {
                d.count = 77;
            });
            handle.commit();
            const finished = machine.finishPatch();
            expect(finished).toBeInstanceOf(MachineRefreshError);
            expect(finished.status).toBe("refresh-error");
        });

        it("finishAllPatches() returns MachineRefreshError", () => {
            const { machine, handle } = makeRefreshError().createPatch((d) => {
                d.count = 77;
            });
            handle.commit();
            const finished = machine.finishAllPatches();
            expect(finished).toBeInstanceOf(MachineRefreshError);
            expect(finished.status).toBe("refresh-error");
        });
    });
});
