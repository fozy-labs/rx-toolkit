import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryEntryStateError, QueryEntryTransitionError } from "../core/errors";
import { Machine, MachineBase } from "../core/machine/Machine";
import { pendingEntryState, snapshotEntryState } from "../core/machine/machine-helpers";
import { MachineInvalidating } from "../core/machine/MachineInvalidating";
import { MachinePending } from "../core/machine/MachinePending";
import type { TQueryEntryState } from "../types";

// ── Helpers ────────────────────────────────────────────────────────

type TestArgs = { id: number };
type TestData = { name: string; count: number };

const ARGS: TestArgs = { id: 1 };
const DATA: TestData = { name: "Alice", count: 10 };
const DATA2: TestData = { name: "Bob", count: 20 };

function makePending() {
    return Machine.of<TestArgs, TestData>(pendingEntryState(ARGS));
}

function makeSuccess() {
    return makePending().success(DATA);
}

function makeError() {
    return makePending().fail(new Error("boom"));
}

function makeInvalidating() {
    return makeSuccess().invalidate();
}

function makeInvalidateError() {
    return makeInvalidating().fail(new Error("invalidate-boom"));
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Machine", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── Initial states ─────────────────────────────────────────────

    describe("pendingEntryState()", () => {
        it("creates a state with status 'pending' and null data/error/updatedAt", () => {
            const state = pendingEntryState<TestArgs>(ARGS);
            expect(state.status).toBe("pending");
            expect(state.data).toBeNull();
            expect(state.error).toBeNull();
            expect(state.updatedAt).toBeNull();
        });

        it("carries no retry flag — a retry in flight is `error !== null`", () => {
            expect(makePending().state).not.toHaveProperty("isRetrying");
            expect(makeSuccess().invalidate().state).not.toHaveProperty("isRetrying");
            expect(makeError().retry().state).not.toHaveProperty("isRetrying");
            expect(makeInvalidateError().retry().state).not.toHaveProperty("isRetrying");
        });

        it("preserves args reference", () => {
            const args = { id: 42 };
            const state = pendingEntryState<TestArgs>(args);
            expect(state.args).toBe(args);
        });
    });

    describe("snapshotEntryState()", () => {
        const snapshot = { args: ARGS, data: DATA, updatedAt: 500 };

        // Staleness is not a state: a stale snapshot hydrates as the same
        // `success` and is marked on the entry (`isInvalidated`) instead.
        it("→ status 'success', patchState null", () => {
            const state = snapshotEntryState<TestArgs, TestData>(snapshot);
            expect(state.status).toBe("success");
            expect(state.data).toBe(DATA);
            expect(state.patchState).toBeNull();
            expect(state.error).toBeNull();
        });

        it("preserves args, data, updatedAt from snapshot", () => {
            const state = snapshotEntryState<TestArgs, TestData>(snapshot);
            expect(state.args).toBe(ARGS);
            expect(state.data).toBe(DATA);
            expect(state.updatedAt).toBe(500);
        });

        it("wraps into the machine that owns the snapshot's transitions", () => {
            const machine = Machine.of<TestArgs, TestData>(snapshotEntryState(snapshot));
            expect(machine.status).toBe("success");
            expect(machine.invalidate().state.status).toBe("invalidating");
        });
    });

    // ── FSM Transition: success() ──────────────────────────────────

    describe("success()", () => {
        it("pending → success: sets data and updatedAt", () => {
            const m = makePending().success(DATA);
            expect(m.state.status).toBe("success");
            expect(m.state.data).toBe(DATA);
            expect(m.state.updatedAt).toBe(1000);
        });

        it("returns a new instance (immutability)", () => {
            const m1 = makePending();
            const m2 = m1.success(DATA);
            expect(m2).not.toBe(m1);
            expect(m1.state.status).toBe("pending");
        });

        it("throws QueryEntryTransitionError from success state", () => {
            expect(() => makeSuccess().success(DATA2)).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from error state", () => {
            expect(() => makeError().success(DATA)).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from invalidating state", () => {
            expect(() => makeInvalidating().success(DATA2)).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from invalidate-error state", () => {
            expect(() => makeInvalidateError().success(DATA2)).toThrow(QueryEntryTransitionError);
        });
    });

    // ── FSM Transition: fail() ─────────────────────────────────────

    describe("fail()", () => {
        it("pending → error: data null, error preserved", () => {
            const err = new Error("oops");
            const m = makePending().fail(err);
            expect(m.state.status).toBe("error");
            expect(m.state.data).toBeNull();
            expect(m.state.error).toBe(err);
        });

        it("invalidating → invalidate-error: preserves data and patchState", () => {
            const err = new Error("invalidate oops");
            const m = makeInvalidating().fail(err);
            expect(m.state.status).toBe("invalidate-error");
            expect(m.state.data).toEqual(DATA);
            expect(m.state.error).toBe(err);
        });

        it("invalidating → invalidate-error: preserves patchState when present", () => {
            const invalidating = makeSuccess()
                .createPatch((d) => {
                    d.count = 99;
                })
                .machine.invalidate();
            const err = new Error("fail with patches");
            const m = invalidating.fail(err);
            expect(m.state.status).toBe("invalidate-error");
            if (m.state.status === "invalidate-error") {
                expect(m.state.patchState).not.toBeNull();
            }
        });

        it("success → invalidate-error (stream failure after data): preserves data and patchState", () => {
            const err = new Error("stream oops");
            const { machine: patched } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            const m = patched.fail(err);
            expect(m.state.status).toBe("invalidate-error");
            expect(m.state.data).toEqual({ ...DATA, count: 99 });
            expect(m.state.error).toBe(err);
            if (m.state.status === "invalidate-error") {
                expect(m.state.patchState).not.toBeNull();
            }
        });

        it("throws QueryEntryTransitionError from error state", () => {
            expect(() => makeError().fail(new Error())).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from invalidate-error state", () => {
            expect(() => makeInvalidateError().fail(new Error())).toThrow(QueryEntryTransitionError);
        });
    });

    // ── FSM Transition: next() ─────────────────────────────────────

    describe("next()", () => {
        it("success → success (no patches): uses new data, bumps updatedAt", () => {
            const m1 = makeSuccess();
            vi.setSystemTime(2000);
            const m2 = m1.next(DATA2);
            expect(m2.state.status).toBe("success");
            expect(m2.state.data).toBe(DATA2);
            expect(m2.state.updatedAt).toBe(2000);
            if (m2.state.status === "success") {
                expect(m2.state.patchState).toBeNull();
            }
        });

        it("success → success (with patches): replays pending patches on new base", () => {
            const { machine: patched } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            const m = patched.next(DATA2);
            expect(m.state.status).toBe("success");
            expect(m.state.data).toEqual({ ...DATA2, count: 99 });
            if (m.state.status === "success") {
                expect(m.state.patchState).not.toBeNull();
            }
        });

        it("throws QueryEntryTransitionError from pending state", () => {
            expect(() => makePending().next(DATA)).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from invalidating state", () => {
            expect(() => makeInvalidating().next(DATA2)).toThrow(QueryEntryTransitionError);
        });
    });

    // ── FSM Transition: invalidate() ──────────────────────────────────

    describe("invalidate()", () => {
        it("success → invalidating: preserves data, patchState, clears error", () => {
            const m = makeSuccess().invalidate();
            expect(m.state.status).toBe("invalidating");
            expect(m.state.data).toEqual(DATA);
            expect(m.state.error).toBeNull();
        });

        it("invalidate-error → invalidating: preserves data and patchState, not a retry", () => {
            const m = makeInvalidateError().invalidate();
            expect(m.state.status).toBe("invalidating");
            expect(m.state.data).toEqual(DATA);
            expect(m.state.error).toBeNull();
        });

        it("error → pending: same args, clears the error (not a retry)", () => {
            const failed = makeError();
            const m = failed.invalidate();
            expect(m.state.status).toBe("pending");
            expect(m.state.args).toEqual(ARGS);
            expect(m.state.data).toBeNull();
            expect(m.state.error).toBeNull();
            expect(m.state.updatedAt).toBeNull();
        });

        it("preserves patchState through invalidate", () => {
            expect.assertions(1);
            const { machine: patched } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            const invalidated = patched.invalidate();
            if (invalidated.state.status === "invalidating") {
                expect(invalidated.state.patchState).not.toBeNull();
            }
        });

        it("throws QueryEntryTransitionError from pending state", () => {
            expect(() => makePending().invalidate()).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from invalidating state", () => {
            expect(() => makeInvalidating().invalidate()).toThrow(QueryEntryTransitionError);
        });
    });

    // ── FSM Transition: retry() ────────────────────────────────────

    describe("retry()", () => {
        it("error → pending: preserves args and the error (the only retry marker), resets data/updatedAt", () => {
            const failed = makeError();
            const m = failed.retry();
            expect(m.state.status).toBe("pending");
            expect(m.state.args).toEqual(ARGS);
            expect(m.state.data).toBeNull();
            expect(m.state.error).toBe(failed.state.error);
            expect(m.state.updatedAt).toBeNull();
        });

        it("invalidate-error → invalidating: preserves data, patchState and the error (the retry marker)", () => {
            const { machine: patched } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            const failed = patched.invalidate().fail(new Error("invalidate-boom"));
            const m = failed.retry();

            expect(m.state.status).toBe("invalidating");
            expect(m.state.data).toEqual({ ...DATA, count: 99 });
            expect(m.state.error).toBe(failed.state.error);
            expect(m.state.updatedAt).toBe(failed.state.updatedAt);
            if (m.state.status === "invalidating") {
                expect(m.state.patchState).not.toBeNull();
            }
        });

        it("the retried error survives patch operations on the retrying invalidating state", () => {
            expect.assertions(2);
            const retrying = makeInvalidateError().retry();
            const { machine: patched, handle } = retrying.createPatch((d) => {
                d.count = 1;
            });
            if (patched.state.status === "invalidating") {
                expect(patched.state.error).toBe(retrying.state.error);
            }

            handle.commit();
            const finished = patched.finishPatch();
            if (finished.state.status === "invalidating") {
                expect(finished.state.error).toBe(retrying.state.error);
            }
        });

        it("patch operations on a plain invalidating state keep error null", () => {
            expect.assertions(2);
            const invalidating = makeInvalidating();
            const { machine: patched, handle } = invalidating.createPatch((d) => {
                d.count = 1;
            });
            if (patched.state.status === "invalidating") {
                expect(patched.state.error).toBeNull();
            }

            handle.commit();
            const finished = patched.finishPatch();
            if (finished.state.status === "invalidating") {
                expect(finished.state.error).toBeNull();
            }
        });

        it("the retried error is dropped once the retry settles", () => {
            const succeeded = makeError().retry().success(DATA);
            expect(succeeded.state.error).toBeNull();

            const rebased = makeInvalidateError().retry().rebase(DATA2);
            expect(rebased.state.error).toBeNull();

            const again = new Error("again");
            const failed = makeInvalidateError().retry().fail(again);
            expect(failed.state.error).toBe(again);
        });

        it("throws QueryEntryTransitionError from pending state", () => {
            expect(() => makePending().retry()).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from success state", () => {
            expect(() => makeSuccess().retry()).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from invalidating state", () => {
            expect(() => makeInvalidating().retry()).toThrow(QueryEntryTransitionError);
        });
    });

    // ── FSM Transition: rebase() ───────────────────────────────────

    describe("rebase()", () => {
        it("invalidating → success (no patches): uses new data, sets updatedAt", () => {
            const m = makeInvalidating().rebase(DATA2);
            expect(m.state.status).toBe("success");
            expect(m.state.data).toEqual(DATA2);
            expect(m.state.updatedAt).toBe(1000);
        });

        it("invalidating → success (with patches): replays patches on new base", () => {
            // success → patch → invalidate → rebase
            const { machine: patched, handle } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            handle.commit();
            const invalidated = patched.invalidate();
            const rebased = invalidated.rebase({ name: "Server", count: 50 });
            expect(rebased.state.status).toBe("success");
            // Committed patches are applied on new base: count becomes 99
            expect(rebased.state.data).toEqual({ name: "Server", count: 99 });
        });

        it("replays pending patches on new base and keeps patchState", () => {
            expect.assertions(2);
            const { machine: patched } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            // handle NOT committed → still pending
            const invalidated = patched.invalidate();
            const rebased = invalidated.rebase({ name: "Server", count: 50 });
            if (rebased.state.status === "success") {
                expect(rebased.state.patchState).not.toBeNull();
                expect(rebased.state.data).toEqual({ name: "Server", count: 99 });
            }
        });

        it("throws QueryEntryTransitionError from pending state", () => {
            expect(() => makePending().rebase(DATA2)).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from success state", () => {
            expect(() => makeSuccess().rebase(DATA2)).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from error state", () => {
            expect(() => makeError().rebase(DATA2)).toThrow(QueryEntryTransitionError);
        });

        it("throws QueryEntryTransitionError from invalidate-error state", () => {
            expect(() => makeInvalidateError().rebase(DATA2)).toThrow(QueryEntryTransitionError);
        });
    });

    // ── createPatch() ──────────────────────────────────────────────

    describe("createPatch()", () => {
        it("creates patch entry and returns new machine with updated data + handle", () => {
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 42;
            });
            expect(machine.state.status).toBe("success");
            expect(machine.state.data).toEqual({ name: "Alice", count: 42 });
            expect(handle).toBeDefined();
            expect(typeof handle.commit).toBe("function");
            expect(typeof handle.abort).toBe("function");
        });

        it("preserves originalData from first call", () => {
            expect.assertions(1);
            const { machine: m1 } = makeSuccess().createPatch((d) => {
                d.count = 50;
            });
            const { machine: m2 } = m1.createPatch((d) => {
                d.count = 60;
            });
            if (m2.state.status === "success" && m2.state.patchState) {
                expect(m2.state.patchState.originalData).toEqual(DATA);
            }
        });

        it("stacks: second patch builds on first", () => {
            expect.assertions(2);
            const { machine: m1 } = makeSuccess().createPatch((d) => {
                d.count = 50;
            });
            const { machine: m2 } = m1.createPatch((d) => {
                d.count = d.count + 10;
            });
            expect(m2.state.data).toEqual({ name: "Alice", count: 60 });
            if (m2.state.status === "success" && m2.state.patchState) {
                expect(m2.state.patchState.patches.length).toBe(2);
            }
        });

        it("handle.commit() sets entry status to 'committed'", () => {
            expect.assertions(1);
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 42;
            });
            handle.commit();
            if (machine.state.status === "success" && machine.state.patchState) {
                expect(machine.state.patchState.patches[0].status).toBe("committed");
            }
        });

        it("handle.abort() sets entry status to 'aborted'", () => {
            expect.assertions(1);
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 42;
            });
            handle.abort();
            if (machine.state.status === "success" && machine.state.patchState) {
                expect(machine.state.patchState.patches[0].status).toBe("aborted");
            }
        });

        it("handle is idempotent after settle — commit then abort is no-op", () => {
            expect.assertions(1);
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 42;
            });
            handle.commit();
            handle.abort(); // should be ignored
            if (machine.state.status === "success" && machine.state.patchState) {
                expect(machine.state.patchState.patches[0].status).toBe("committed");
            }
        });

        it("handle is idempotent after settle — abort then commit is no-op", () => {
            expect.assertions(1);
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 42;
            });
            handle.abort();
            handle.commit(); // should be ignored
            if (machine.state.status === "success" && machine.state.patchState) {
                expect(machine.state.patchState.patches[0].status).toBe("aborted");
            }
        });

        it("works in invalidating state", () => {
            const { machine } = makeInvalidating().createPatch((d) => {
                d.count = 77;
            });
            expect(machine.state.status).toBe("invalidating");
            expect(machine.state.data).toEqual({ name: "Alice", count: 77 });
        });

        it("works in invalidate-error state", () => {
            const { machine } = makeInvalidateError().createPatch((d) => {
                d.count = 88;
            });
            expect(machine.state.status).toBe("invalidate-error");
            expect(machine.state.data).toEqual({ name: "Alice", count: 88 });
        });

        it("throws QueryEntryStateError from pending state", () => {
            expect(() => makePending().createPatch(() => {})).toThrow(QueryEntryStateError);
        });

        it("throws QueryEntryStateError from error state", () => {
            expect(() => makeError().createPatch(() => {})).toThrow(QueryEntryStateError);
        });

        it("returns a new Machine instance (immutability)", () => {
            const m1 = makeSuccess();
            const { machine: m2 } = m1.createPatch((d) => {
                d.count = 42;
            });
            expect(m2).not.toBe(m1);
            expect(m1.state.data).toEqual(DATA);
        });
    });

    // ── finishPatch() ──────────────────────────────────────────────

    describe("finishPatch()", () => {
        it("committed patch → data = patched originalData, patchState cleared", () => {
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            handle.commit();
            const finished = machine.finishPatch();
            expect(finished.state.status).toBe("success");
            expect(finished.state.data).toEqual({ name: "Alice", count: 99 });
            if (finished.state.status === "success") {
                expect(finished.state.patchState).toBeNull();
            }
        });

        it("aborted patch → original data restored, patchState cleared", () => {
            expect.assertions(2);
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.count = 99;
            });
            handle.abort();
            const finished = machine.finishPatch();
            expect(finished.state.data).toEqual(DATA);
            if (finished.state.status === "success") {
                expect(finished.state.patchState).toBeNull();
            }
        });

        it("committed + pending → committed merged, pending replayed", () => {
            expect.assertions(3);
            const { machine: m1, handle: h1 } = makeSuccess().createPatch((d) => {
                d.count = 50;
            });
            h1.commit();
            const { machine: m2 } = m1.createPatch((d) => {
                d.count = d.count + 10;
            });
            // h2 left pending
            const finished = m2.finishPatch();
            if (finished.state.status === "success" && finished.state.patchState) {
                // Original data should now incorporate committed patch
                expect(finished.state.patchState.originalData).toEqual({ name: "Alice", count: 50 });
                // Pending patch remains
                expect(finished.state.patchState.patches.length).toBe(1);
                expect(finished.state.patchState.patches[0].status).toBe("pending");
            }
        });

        it("stops at first pending patch", () => {
            expect.assertions(1);
            const { machine: m1, handle: h1 } = makeSuccess().createPatch((d) => {
                d.count = 50;
            });
            // h1 left pending
            const { machine: m2, handle: h2 } = m1.createPatch((d) => {
                d.count = 60;
            });
            h2.commit();
            const finished = m2.finishPatch();
            if (finished.state.status === "success" && finished.state.patchState) {
                // Both patches remain because first is pending
                expect(finished.state.patchState.patches.length).toBe(2);
            }
        });

        it("throws QueryEntryStateError when no active patchState", () => {
            expect(() => makeSuccess().finishPatch()).toThrow(QueryEntryStateError);
        });

        it("throws QueryEntryStateError from pending state", () => {
            expect(() => makePending().finishPatch()).toThrow(QueryEntryStateError);
        });

        it("throws QueryEntryStateError from error state", () => {
            expect(() => makeError().finishPatch()).toThrow(QueryEntryStateError);
        });
    });

    // ── finishAllPatches() ─────────────────────────────────────────

    describe("finishAllPatches()", () => {
        it("processes all settled patches", () => {
            expect.assertions(2);
            const { machine: m1, handle: h1 } = makeSuccess().createPatch((d) => {
                d.count = 50;
            });
            h1.commit();
            const { machine: m2, handle: h2 } = m1.createPatch((d) => {
                d.count = 60;
            });
            h2.commit();
            const finished = m2.finishAllPatches();
            expect(finished.state.data).toEqual({ name: "Alice", count: 60 });
            if (finished.state.status === "success") {
                expect(finished.state.patchState).toBeNull();
            }
        });

        it("processes committed patches past a pending one", () => {
            expect.assertions(3);
            const { machine: m1, handle: h1 } = makeSuccess().createPatch((d) => {
                d.count = 50;
            });
            h1.commit();
            const { machine: m2 } = m1.createPatch((d) => {
                d.count = 60;
            });
            // h2 left pending
            const { machine: m3, handle: h3 } = m2.createPatch((d) => {
                d.count = 70;
            });
            h3.commit();
            // finishPatch would stop at the pending — finishAllPatches should continue
            const finished = m3.finishAllPatches();
            if (finished.state.status === "success" && finished.state.patchState) {
                // Both committed folded into originalData, only pending remains
                expect(finished.state.patchState.patches.length).toBe(1);
                expect(finished.state.patchState.patches[0].status).toBe("pending");
            }
            // The optimistic data should still include the pending patch effect
            expect(finished.state.data).toEqual({ name: "Alice", count: 60 });
        });

        it("throws QueryEntryStateError when no active patchState", () => {
            expect(() => makeSuccess().finishAllPatches()).toThrow(QueryEntryStateError);
        });
    });

    // ── Immutability Invariant ─────────────────────────────────────

    describe("immutability", () => {
        it("success() returns a new instance, original unchanged", () => {
            const m1 = makePending();
            const s1 = m1.state;
            const m2 = m1.success(DATA);
            expect(Object.is(m1.state, s1)).toBe(true);
            expect(m1.state.status).toBe("pending");
            expect(m2.state.status).toBe("success");
        });

        it("fail() returns a new instance, original unchanged", () => {
            const m1 = makePending();
            const s1 = m1.state;
            m1.fail(new Error("e"));
            expect(Object.is(m1.state, s1)).toBe(true);
        });

        it("invalidate() returns a new instance, original unchanged", () => {
            const m1 = makeSuccess();
            const s1 = m1.state;
            m1.invalidate();
            expect(Object.is(m1.state, s1)).toBe(true);
        });

        it("retry() returns a new instance, original unchanged", () => {
            const m1 = makeError();
            const s1 = m1.state;
            m1.retry();
            expect(Object.is(m1.state, s1)).toBe(true);
        });

        it("rebase() returns a new instance, original unchanged", () => {
            const m1 = makeInvalidating();
            const s1 = m1.state;
            m1.rebase(DATA2);
            expect(Object.is(m1.state, s1)).toBe(true);
        });

        it("createPatch() returns a new instance, original unchanged", () => {
            const m1 = makeSuccess();
            const s1 = m1.state;
            m1.createPatch((d) => {
                d.count = 0;
            });
            expect(Object.is(m1.state, s1)).toBe(true);
        });
    });

    // ── Full Transition Matrix ─────────────────────────────────────

    describe("transition matrix — drawn edges transition, everything else throws", () => {
        const methods = ["success", "fail", "invalidate", "retry", "rebase", "next"] as const;

        // Map of valid transitions: [fromState, method] → resulting status
        const validTransitions = new Map([
            ["pending:success", "success"],
            ["pending:fail", "error"],
            ["success:invalidate", "invalidating"],
            ["success:fail", "invalidate-error"],
            ["success:next", "success"],
            ["error:retry", "pending"],
            ["error:invalidate", "pending"],
            ["invalidating:fail", "invalidate-error"],
            ["invalidating:rebase", "success"],
            ["invalidate-error:invalidate", "invalidating"],
            ["invalidate-error:retry", "invalidating"],
        ]);

        const states = {
            pending: makePending,
            success: makeSuccess,
            error: makeError,
            invalidating: makeInvalidating,
            "invalidate-error": makeInvalidateError,
        } as const;

        const methodArgs: Record<string, unknown[]> = {
            success: [DATA],
            fail: [new Error("e")],
            invalidate: [],
            retry: [],
            rebase: [DATA2],
            next: [DATA2],
        };

        for (const [stateName, factory] of Object.entries(states)) {
            for (const method of methods) {
                const key = `${stateName}:${method}`;
                const target = validTransitions.get(key);

                if (target !== undefined) {
                    it(`${stateName} + ${method}() → ${target}`, () => {
                        const m = factory();
                        const next = (m as any)[method](...methodArgs[method]);
                        expect(next.state.status).toBe(target);
                    });
                    continue;
                }

                it(`${stateName} + ${method}() → throws`, () => {
                    const m = factory();
                    expect(() => (m as any)[method](...methodArgs[method])).toThrow();
                });
            }
        }
    });

    // ── Immer Patching Scenarios ───────────────────────────────────

    describe("immer patching scenarios", () => {
        it("scenario 1: single committed patch → finishPatch → patched data, patchState null", () => {
            expect.assertions(2);
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.name = "Patched";
            });
            handle.commit();
            const finished = machine.finishPatch();
            expect(finished.state.data).toEqual({ name: "Patched", count: 10 });
            if (finished.state.status === "success") {
                expect(finished.state.patchState).toBeNull();
            }
        });

        it("scenario 2: committed + pending → finishPatch → committed merged, pending replayed", () => {
            expect.assertions(2);
            const { machine: m1, handle: h1 } = makeSuccess().createPatch((d) => {
                d.name = "First";
            });
            h1.commit();
            const { machine: m2 } = m1.createPatch((d) => {
                d.name = "Second";
            });
            // pending
            const finished = m2.finishPatch();
            if (finished.state.status === "success" && finished.state.patchState) {
                expect(finished.state.patchState.originalData).toEqual({ name: "First", count: 10 });
                expect(finished.state.patchState.patches.length).toBe(1);
            }
        });

        it("scenario 3: aborted patch → finishPatch → original data restored", () => {
            const { machine, handle } = makeSuccess().createPatch((d) => {
                d.name = "Nope";
            });
            handle.abort();
            const finished = machine.finishPatch();
            expect(finished.state.data).toEqual(DATA);
        });

        it("scenario 4: rebase with active patches replays via rebasePatches", () => {
            const { machine: patched, handle } = makeSuccess().createPatch((d) => {
                d.count = 77;
            });
            handle.commit();
            const invalidated = patched.invalidate();
            const serverData: TestData = { name: "ServerName", count: 200 };
            const rebased = invalidated.rebase(serverData);
            // Committed patch sets count=77, replayed on new base
            expect(rebased.state.data).toEqual({ name: "ServerName", count: 77 });
        });

        it("scenario 5: replay failure → isConsistencyViolation = true", () => {
            // Create a situation where rebase patches can't apply.
            // We need an incompatible structure change.
            type Complex = { items: number[] };
            const m = Machine.of<string, Complex>(pendingEntryState("a")).success({ items: [1, 2, 3] });

            // Patch: modify index 2
            const { machine: patched, handle } = m.createPatch((d) => {
                d.items[2] = 999;
            });
            handle.commit();

            const invalidated = patched.invalidate();
            // Rebase with data that has no items[2] — this should trigger consistency violation
            // Use a completely different structure to cause rebasePatches to fail
            // Actually, immer patches are path-based, so applying index 2 on a shorter array may still work.
            // Let's use a more drastic approach:
            const newBase = { items: [] as number[] };
            const rebased = invalidated.rebase(newBase);
            // The patch tries to replace items[2] but items is empty.
            // Depending on immer behavior, this may or may not throw.
            // If it doesn't throw, data is patched; if it does, consistency violation.
            // We test whichever outcome the machine produces is valid:
            if (rebased.state.status === "success" && rebased.state.patchState?.isConsistencyViolation) {
                expect(rebased.state.patchState.isConsistencyViolation).toBe(true);
            } else {
                // immer applied the patch successfully, which is also valid
                expect(rebased.state.status).toBe("success");
            }
        });

        it("scenario 6: a discarded replay stays in the current status, flagged", () => {
            // A patch on items[0] cannot replay over an empty array, so the
            // rebase throws its own result away. It settles nothing: the state
            // must stay `invalidating` (query still owed) with the timestamp of
            // the last real settle, never a `success` carrying data the server
            // never sent.
            type Nested = { items: { n: number }[] };
            const base = new MachinePending<string, Nested>(pendingEntryState("a")).success({ items: [{ n: 1 }] });

            const { machine: patched } = base.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });

            const invalidating = patched.invalidate();
            const rebased = invalidating.rebase({ items: [] });

            expect(rebased.status).toBe("invalidating");
            expect(rebased.state).toMatchObject({
                status: "invalidating",
                data: { items: [{ n: 99 }] },
                updatedAt: invalidating.state.updatedAt,
                patchState: { isConsistencyViolation: true, patches: [] },
            });
        });

        it("scenario 7: the run after a discarded replay lands in a clean success", () => {
            type Nested = { items: { n: number }[] };
            const base = new MachinePending<string, Nested>(pendingEntryState("a")).success({ items: [{ n: 1 }] });

            const { machine: patched } = base.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });

            const discarded = patched.invalidate().rebase({ items: [] });
            expect(discarded.status).toBe("invalidating");

            // The flagged patch state holds no patches, so the next rebase has
            // nothing to replay and takes the server data as it is.
            const settled = (discarded as MachineInvalidating<string, Nested>).rebase({ items: [{ n: 5 }] });

            expect(settled.status).toBe("success");
            expect(settled.state).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });
            expect(settled.state.patchState).toBeNull();
        });
    });

    // ── Edge Cases ─────────────────────────────────────────────────

    describe("edge cases", () => {
        it("double transition from same machine instance (fork)", () => {
            const pending = makePending();
            const success = pending.success(DATA);
            const error = pending.fail(new Error("e"));
            expect(success.state.status).toBe("success");
            expect(error.state.status).toBe("error");
        });

        it("createPatch with no-op recipe still creates a patch entry", () => {
            expect.assertions(1);
            const { machine } = makeSuccess().createPatch(() => {});
            if (machine.state.status === "success" && machine.state.patchState) {
                expect(machine.state.patchState.patches.length).toBe(1);
            }
        });

        it("multiple patches committed then finishPatch clears all", () => {
            expect.assertions(2);
            const { machine: m1, handle: h1 } = makeSuccess().createPatch((d) => {
                d.count = 20;
            });
            h1.commit();
            const { machine: m2, handle: h2 } = m1.createPatch((d) => {
                d.count = 30;
            });
            h2.commit();
            const { machine: m3, handle: h3 } = m2.createPatch((d) => {
                d.count = 40;
            });
            h3.commit();
            const finished = m3.finishPatch();
            expect(finished.state.data).toEqual({ name: "Alice", count: 40 });
            if (finished.state.status === "success") {
                expect(finished.state.patchState).toBeNull();
            }
        });

        it("aborted patch in the middle: committed-aborted-committed", () => {
            const { machine: m1, handle: h1 } = makeSuccess().createPatch((d) => {
                d.count = 20;
            });
            h1.commit();
            const { machine: m2, handle: h2 } = m1.createPatch((d) => {
                d.count = 30;
            });
            h2.abort();
            const { machine: m3, handle: h3 } = m2.createPatch((d) => {
                d.count = 40;
            });
            h3.commit();
            const finished = m3.finishPatch();
            // Committed patches: count=20, then count=40 (aborted skipped)
            expect(finished.state.status).toBe("success");
            if (finished.state.status === "success") {
                expect(finished.state.patchState).toBeNull();
            }
        });

        it("error message contains method name and state", () => {
            expect.assertions(2);
            try {
                makeSuccess().success(DATA2);
            } catch (e: any) {
                expect(e.message).toContain("success");
                expect(e.message).toContain("success");
            }
        });

        it("finishPatch in invalidating state with patchState", () => {
            const { machine: patched, handle } = makeSuccess().createPatch((d) => {
                d.count = 42;
            });
            handle.commit();
            const invalidated = patched.invalidate();
            const finished = invalidated.finishPatch();
            expect(finished.state.status).toBe("invalidating");
            expect(finished.state.data).toEqual({ name: "Alice", count: 42 });
        });
    });

    // ── MachineBase fallback transitions ───────────────────────────

    /**
     * The subtypes override their own edges; `MachineBase` keeps the full guard
     * table for machines built by the base transitions themselves. Exercised
     * through a harness because the base constructor is protected.
     */
    describe("MachineBase guard table", () => {
        class BaseHarness<TArgs, TData> extends MachineBase<TArgs, TData> {
            constructor(state: TQueryEntryState<TArgs, TData>) {
                super(state);
            }
        }

        const baseError = () =>
            new BaseHarness<TestArgs, TestData>({
                status: "error",
                args: ARGS,
                data: null,
                error: new Error("boom"),
                updatedAt: null,
            });

        const baseSuccess = () =>
            new BaseHarness<TestArgs, TestData>({
                status: "success",
                args: ARGS,
                data: DATA,
                error: null,
                updatedAt: 1000,
                patchState: null,
            });

        const baseInvalidateError = () =>
            new BaseHarness<TestArgs, TestData>({
                status: "invalidate-error",
                args: ARGS,
                data: DATA,
                error: new Error("invalidate-boom"),
                updatedAt: 1000,
                patchState: null,
            });

        it("invalidate() from error → pending with a cleared error", () => {
            const m = baseError().invalidate();
            expect(m.state.status).toBe("pending");
            expect(m.state.args).toEqual(ARGS);
            expect(m.state.data).toBeNull();
            expect(m.state.error).toBeNull();
            expect(m.state.updatedAt).toBeNull();
        });

        it("invalidate() from success / invalidate-error → invalidating with a cleared error", () => {
            for (const failed of [baseSuccess(), baseInvalidateError()]) {
                const m = failed.invalidate();
                expect(m.state.status).toBe("invalidating");
                expect(m.state.data).toEqual(DATA);
                expect(m.state.error).toBeNull();
            }
        });

        it("retry() keeps the retried error as the only retry marker", () => {
            const failed = baseError();
            const retried = failed.retry();
            expect(retried.state.status).toBe("pending");
            expect(retried.state.error).toBe(failed.state.error);
            expect(retried.state).not.toHaveProperty("isRetrying");

            const invalidateFailed = baseInvalidateError();
            const reRetried = invalidateFailed.retry();
            expect(reRetried.state.status).toBe("invalidating");
            expect(reRetried.state.error).toBe(invalidateFailed.state.error);
            expect(reRetried.state).not.toHaveProperty("isRetrying");
        });

        it("throws QueryEntryTransitionError on undrawn edges", () => {
            expect(() => baseError().success(DATA)).toThrow(QueryEntryTransitionError);
            expect(() => baseError().fail(new Error("e"))).toThrow(QueryEntryTransitionError);
            expect(() => baseError().rebase(DATA2)).toThrow(QueryEntryTransitionError);
            expect(() => baseError().next(DATA2)).toThrow(QueryEntryTransitionError);
            expect(() => baseSuccess().retry()).toThrow(QueryEntryTransitionError);
        });
    });
});
