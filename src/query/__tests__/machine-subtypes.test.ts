import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MachineError } from "../core/machine/MachineError";
import { MachineInvalidateError } from "../core/machine/MachineInvalidateError";
import { MachineInvalidating } from "../core/machine/MachineInvalidating";
import { MachinePending } from "../core/machine/MachinePending";
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

function makeInvalidating() {
    return new MachineInvalidating<TestArgs, TestData>({
        status: "invalidating",
        args: ARGS,
        data: DATA,
        error: null,
        updatedAt: 1000,
        patchState: null,
    });
}

function makeInvalidateError() {
    return new MachineInvalidateError<TestArgs, TestData>({
        status: "invalidate-error",
        args: ARGS,
        data: DATA,
        error: new Error("invalidate-boom"),
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

        it("invalidate() returns MachineInvalidating", () => {
            const m = makeSuccess().invalidate();
            expect(m).toBeInstanceOf(MachineInvalidating);
            expect(m.status).toBe("invalidating");
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

        it("retry() returns MachinePending keeping the error (the retry marker)", () => {
            const failed = makeError();
            const m = failed.retry();
            expect(m).toBeInstanceOf(MachinePending);
            expect(m.status).toBe("pending");
            expect(m.state.args).toBe(ARGS);
            expect(m.state.data).toBeNull();
            expect(m.state.error).toBe(failed.state.error);
        });

        it("invalidate() returns MachinePending with a cleared error", () => {
            const m = makeError().invalidate();
            expect(m).toBeInstanceOf(MachinePending);
            expect(m.status).toBe("pending");
            expect(m.state.args).toBe(ARGS);
            expect(m.state.data).toBeNull();
            expect(m.state.error).toBeNull();
            expect(m.state.updatedAt).toBeNull();
        });
    });

    // ── MachineInvalidating ──────────────────────────────────────────

    describe("MachineInvalidating", () => {
        it("has status 'invalidating' and correct state shape", () => {
            const m = makeInvalidating();
            expect(m.status).toBe("invalidating");
            expect(m.state.status).toBe("invalidating");
            expect(m.state.data).toBe(DATA);
            expect(m.state.args).toBe(ARGS);
            expect(m.state.updatedAt).toBe(1000);
        });

        it("extends MachineWithData", () => {
            expect(makeInvalidating()).toBeInstanceOf(MachineWithData);
        });

        it("rebase() without patches returns MachineSuccess", () => {
            const m = makeInvalidating().rebase(DATA2);
            expect(m).toBeInstanceOf(MachineSuccess);
            expect(m.status).toBe("success");
            expect(m.state.data).toBe(DATA2);
            expect(m.state.updatedAt).toBe(1000);
        });

        it("rebase() with committed patches replays onto new base", () => {
            const { machine, handle } = makeInvalidating().createPatch((d) => {
                d.count = 99;
            });
            handle.commit();
            const rebased = machine.rebase(DATA2);
            expect(rebased).toBeInstanceOf(MachineSuccess);
            expect(rebased.status).toBe("success");
            // Patch replayed: count should be 99 on the new base
            expect(rebased.state.data.count).toBe(99);
        });

        it("fail() returns MachineInvalidateError", () => {
            const err = new Error("invalidate-fail");
            const m = makeInvalidating().fail(err);
            expect(m).toBeInstanceOf(MachineInvalidateError);
            expect(m.status).toBe("invalidate-error");
            expect(m.state.error).toBe(err);
            expect(m.state.data).toBe(DATA);
        });

        it("createPatch() returns MachineInvalidating", () => {
            const { machine, handle } = makeInvalidating().createPatch((d) => {
                d.count = 50;
            });
            expect(machine).toBeInstanceOf(MachineInvalidating);
            expect(machine.status).toBe("invalidating");
            expect(machine.state.data.count).toBe(50);
            handle.abort();
        });

        it("finishPatch() returns MachineInvalidating", () => {
            const { machine, handle } = makeInvalidating().createPatch((d) => {
                d.count = 50;
            });
            handle.commit();
            const finished = machine.finishPatch();
            expect(finished).toBeInstanceOf(MachineInvalidating);
            expect(finished.status).toBe("invalidating");
        });
    });

    // ── MachineInvalidateError ────────────────────────────────────────

    describe("MachineInvalidateError", () => {
        it("has status 'invalidate-error' and correct state shape", () => {
            const m = makeInvalidateError();
            expect(m.status).toBe("invalidate-error");
            expect(m.state.status).toBe("invalidate-error");
            expect(m.state.data).toBe(DATA);
            expect(m.state.error).toBeInstanceOf(Error);
            expect(m.state.updatedAt).toBe(1000);
        });

        it("extends MachineWithData", () => {
            expect(makeInvalidateError()).toBeInstanceOf(MachineWithData);
        });

        it("invalidate() returns MachineInvalidating", () => {
            const m = makeInvalidateError().invalidate();
            expect(m).toBeInstanceOf(MachineInvalidating);
            expect(m.status).toBe("invalidating");
            expect(m.state.data).toBe(DATA);
            expect(m.state.error).toBeNull();
        });

        it("retry() returns MachineInvalidating keeping the error (the retry marker)", () => {
            const failed = makeInvalidateError();
            const m = failed.retry();
            expect(m).toBeInstanceOf(MachineInvalidating);
            expect(m.status).toBe("invalidating");
            expect(m.state.data).toBe(DATA);
            expect(m.state.error).toBe(failed.state.error);
            expect(m.state.updatedAt).toBe(failed.state.updatedAt);
        });

        it("createPatch() returns MachineInvalidateError", () => {
            const { machine, handle } = makeInvalidateError().createPatch((d) => {
                d.count = 77;
            });
            expect(machine).toBeInstanceOf(MachineInvalidateError);
            expect(machine.status).toBe("invalidate-error");
            expect(machine.state.data.count).toBe(77);
            handle.abort();
        });

        it("finishPatch() returns MachineInvalidateError", () => {
            const { machine, handle } = makeInvalidateError().createPatch((d) => {
                d.count = 77;
            });
            handle.commit();
            const finished = machine.finishPatch();
            expect(finished).toBeInstanceOf(MachineInvalidateError);
            expect(finished.status).toBe("invalidate-error");
        });

        it("finishAllPatches() returns MachineInvalidateError", () => {
            const { machine, handle } = makeInvalidateError().createPatch((d) => {
                d.count = 77;
            });
            handle.commit();
            const finished = machine.finishAllPatches();
            expect(finished).toBeInstanceOf(MachineInvalidateError);
            expect(finished.status).toBe("invalidate-error");
        });
    });
});
