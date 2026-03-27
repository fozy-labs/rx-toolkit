import { Machine } from "@/query-v2/core/machines/Machine";
import { MachineError } from "@/query-v2/core/machines/MachineError";
import { MachineIdle } from "@/query-v2/core/machines/MachineIdle";
import { MachinePending } from "@/query-v2/core/machines/MachinePending";
import { MachineRefreshing } from "@/query-v2/core/machines/MachineRefreshing";
import { MachineSuccess } from "@/query-v2/core/machines/MachineSuccess";

type TestArgs = { id: number };
type TestData = { name: string };

describe("Machine State Transitions", () => {
    // === MachineIdle ===

    describe("MachineIdle", () => {
        it("SM01: Machine.idle() creates MachineIdle", () => {
            const idle = Machine.idle<TestArgs, TestData>();
            expect(idle).toBeInstanceOf(MachineIdle);
            expect(idle.status).toBe("idle");
            expect(idle.args).toBeNull();
            expect(idle.data).toBeNull();
            expect(idle.error).toBeNull();
        });

        it("SM02: idle.start(args) → MachinePending", () => {
            const idle = Machine.idle<TestArgs, TestData>();
            const pending = idle.start({ id: 1 });
            expect(pending).toBeInstanceOf(MachinePending);
            expect(pending.status).toBe("pending");
            expect(pending.args).toEqual({ id: 1 });
            expect(pending.data).toBeNull();
        });

        it("SM03: idle.reset() → MachineIdle", () => {
            const idle = Machine.idle<TestArgs, TestData>();
            const reset = idle.reset();
            expect(reset).toBeInstanceOf(MachineIdle);
        });

        it("SM04: Idle is immutable — start returns new instance", () => {
            const a = Machine.idle<TestArgs, TestData>();
            const b = a.start({ id: 1 });
            expect(a).not.toBe(b);
            expect(a.status).toBe("idle");
        });
    });

    // === MachinePending ===

    describe("MachinePending", () => {
        const getPending = () => Machine.idle<TestArgs, TestData>().start({ id: 1 });

        it("SM05: pending.successHappened(data) → MachineSuccess", () => {
            const pending = getPending();
            const success = pending.successHappened({ name: "test" });
            expect(success).toBeInstanceOf(MachineSuccess);
            expect(success.status).toBe("success");
            expect(success.data).toEqual({ name: "test" });
            expect(success.updatedAt).toEqual(expect.any(Number));
        });

        it("SM06: pending.errorHappened(error) → MachineError", () => {
            const pending = getPending();
            const err = new Error("fail");
            const error = pending.errorHappened(err);
            expect(error).toBeInstanceOf(MachineError);
            expect(error.status).toBe("error");
            expect(error.error).toBe(err);
            expect(error.data).toBeNull();
        });

        it("SM07: pending.reset() → MachineIdle", () => {
            const pending = getPending();
            const idle = pending.reset();
            expect(idle).toBeInstanceOf(MachineIdle);
        });

        it("SM08: Pending preserves args from start", () => {
            const pending = Machine.idle<TestArgs, TestData>().start({ id: 5 });
            expect(pending.args).toEqual({ id: 5 });
        });

        it("SM09: Pending has no patchState", () => {
            const pending = getPending();
            expect(pending.state).not.toHaveProperty("patchState");
        });
    });

    // === MachineSuccess ===

    describe("MachineSuccess", () => {
        const getSuccess = () => Machine.idle<TestArgs, TestData>().start({ id: 1 }).successHappened({ name: "test" });

        it("SM10: success.invalidate() → MachineRefreshing", () => {
            const success = getSuccess();
            const refreshing = success.invalidate();
            expect(refreshing).toBeInstanceOf(MachineRefreshing);
            expect(refreshing.status).toBe("refreshing");
            expect(refreshing.data).toEqual({ name: "test" });
        });

        it("SM11: success.start(newArgs) → MachinePending", () => {
            const success = getSuccess();
            const pending = success.start({ id: 2 });
            expect(pending).toBeInstanceOf(MachinePending);
            expect(pending.args).toEqual({ id: 2 });
        });

        it("SM12: success.reset() → MachineIdle", () => {
            const success = getSuccess();
            const idle = success.reset();
            expect(idle).toBeInstanceOf(MachineIdle);
        });

        it("SM13: Success has updatedAt timestamp", () => {
            const success = getSuccess();
            expect(success.updatedAt).toEqual(expect.any(Number));
            expect(success.updatedAt).toBeGreaterThan(0);
        });

        it("SM14: Success carries data and patchState=null initially", () => {
            const success = getSuccess();
            expect(success.data).toEqual({ name: "test" });
            expect(success.patchState).toBeNull();
        });

        it("SM15: Success .state serialization contains all fields", () => {
            const success = getSuccess();
            const state = success.state;
            expect(state).toEqual({
                status: "success",
                args: { id: 1 },
                data: { name: "test" },
                error: null,
                updatedAt: expect.any(Number),
                patchState: null,
            });
        });
    });

    // === MachineError ===

    describe("MachineError", () => {
        const getError = () => {
            const pending = Machine.idle<TestArgs, TestData>().start({ id: 1 });
            return pending.errorHappened(new Error("fail"));
        };

        it("SM16: error.retry() → MachinePending", () => {
            const error = getError();
            const pending = error.retry();
            expect(pending).toBeInstanceOf(MachinePending);
            expect(pending.args).toEqual({ id: 1 });
        });

        it("SM17: error.start(args) → MachinePending", () => {
            const error = getError();
            const pending = error.start({ id: 3 });
            expect(pending).toBeInstanceOf(MachinePending);
            expect(pending.args).toEqual({ id: 3 });
        });

        it("SM18: error.reset() → MachineIdle", () => {
            const error = getError();
            const idle = error.reset();
            expect(idle).toBeInstanceOf(MachineIdle);
        });

        it("SM19: Error preserves error value", () => {
            const err = new Error("specific error");
            const pending = Machine.idle<TestArgs, TestData>().start({ id: 1 });
            const error = pending.errorHappened(err);
            expect(error.error).toBe(err);
        });
    });

    // === MachineRefreshing ===

    describe("MachineRefreshing", () => {
        const getRefreshing = () => {
            const success = Machine.idle<TestArgs, TestData>().start({ id: 1 }).successHappened({ name: "old" });
            return success.invalidate();
        };

        it("SM20: refreshing.successHappened(freshData) → MachineSuccess", () => {
            const refreshing = getRefreshing();
            const success = refreshing.successHappened({ name: "new" });
            expect(success).toBeInstanceOf(MachineSuccess);
            expect(success.data).toEqual({ name: "new" });
        });

        it("SM21: refreshing.errorHappened(err) → MachineSuccess (stale preserved)", () => {
            const refreshing = getRefreshing();
            const success = refreshing.errorHappened(new Error("network error"));
            expect(success).toBeInstanceOf(MachineSuccess);
            expect(success.data).toEqual({ name: "old" });
        });

        it("SM22: refreshing.reset() → MachineIdle", () => {
            const refreshing = getRefreshing();
            const idle = refreshing.reset();
            expect(idle).toBeInstanceOf(MachineIdle);
        });

        it("SM23: Refreshing preserves stale data during background refetch", () => {
            const success = Machine.idle<TestArgs, TestData>().start({ id: 1 }).successHappened({ name: "stale" });
            const refreshing = success.invalidate();
            expect(refreshing.data).toEqual({ name: "stale" });
        });

        it("SM24: Refreshing preserves patches from success state", () => {
            const success = Machine.idle<TestArgs, { name: string; x?: number }>()
                .start({ id: 1 })
                .successHappened({ name: "data" });
            const patched = success.createPatch((d) => {
                d.x = 42;
            });
            expect(patched).not.toBeNull();
            const patchedSuccess = patched!.machine as MachineSuccess<TestArgs, { name: string; x?: number }>;
            const refreshing = patchedSuccess.invalidate();
            expect(refreshing.patchState).not.toBeNull();
            expect(refreshing.patchState!.patches).toHaveLength(1);
        });
    });

    // === Machine Static Factory ===

    describe("Machine.fromSnapshot", () => {
        it("SM25: fromSnapshot(idleState) → MachineIdle", () => {
            const state = { status: "idle" as const, args: null, data: null, error: null, updatedAt: null };
            const machine = Machine.fromSnapshot<TestArgs, TestData>(state);
            expect(machine).toBeInstanceOf(MachineIdle);
        });

        it("SM26: fromSnapshot(successState) → MachineSuccess with data", () => {
            const state = {
                status: "success" as const,
                args: { id: 1 },
                data: { name: "restored" },
                error: null,
                updatedAt: 1000,
                patchState: null,
            };
            const machine = Machine.fromSnapshot<TestArgs, TestData>(state);
            expect(machine).toBeInstanceOf(MachineSuccess);
            expect((machine as MachineSuccess<TestArgs, TestData>).data).toEqual({ name: "restored" });
        });

        it("SM27: fromSnapshot(pendingState) → MachinePending", () => {
            const state = {
                status: "pending" as const,
                args: { id: 1 },
                data: null,
                error: null,
                updatedAt: null,
            };
            const machine = Machine.fromSnapshot<TestArgs, TestData>(state);
            expect(machine).toBeInstanceOf(MachinePending);
        });

        it("SM28: fromSnapshot(errorState) → MachineError", () => {
            const err = new Error("snapshot error");
            const state = {
                status: "error" as const,
                args: { id: 1 },
                data: null,
                error: err,
                updatedAt: null,
            };
            const machine = Machine.fromSnapshot<TestArgs, TestData>(state);
            expect(machine).toBeInstanceOf(MachineError);
            expect((machine as MachineError<TestArgs, TestData>).error).toBe(err);
        });

        it("SM29: fromSnapshot(refreshingState) → MachineRefreshing", () => {
            const state = {
                status: "refreshing" as const,
                args: { id: 1 },
                data: { name: "stale" },
                error: null,
                updatedAt: 2000,
                patchState: null,
            };
            const machine = Machine.fromSnapshot<TestArgs, TestData>(state);
            expect(machine).toBeInstanceOf(MachineRefreshing);
            expect((machine as MachineRefreshing<TestArgs, TestData>).data).toEqual({ name: "stale" });
        });

        it("SM30: Round-trip: instance → .state → fromSnapshot() → identical logic", () => {
            const idle = Machine.idle<TestArgs, TestData>();
            const fromIdle = Machine.fromSnapshot<TestArgs, TestData>(idle.state);
            expect(fromIdle).toBeInstanceOf(MachineIdle);
            expect(fromIdle.status).toBe("idle");

            const success = idle.start({ id: 1 }).successHappened({ name: "round-trip" });
            const fromSuccess = Machine.fromSnapshot<TestArgs, TestData>(success.state);
            expect(fromSuccess).toBeInstanceOf(MachineSuccess);
            expect((fromSuccess as MachineSuccess<TestArgs, TestData>).data).toEqual({ name: "round-trip" });
        });
    });

    // === MachineWithData (Patcher integration) ===

    describe("MachineWithData (Patcher integration)", () => {
        const getSuccess = () =>
            Machine.idle<TestArgs, { name: string; x?: number }>().start({ id: 1 }).successHappened({ name: "data" });

        it("SM31: createPatch(patchFn) returns { machine, patchHandle }", () => {
            const success = getSuccess();
            const result = success.createPatch((d) => {
                d.x = 1;
            });
            expect(result).not.toBeNull();
            expect(result!.machine).toBeDefined();
            expect(result!.patchHandle).toBeDefined();
            expect(result!.patchHandle.commit).toEqual(expect.any(Function));
            expect(result!.patchHandle.abort).toEqual(expect.any(Function));
            // Machine should have patched data
            const patched = result!.machine as MachineSuccess<TestArgs, { name: string; x?: number }>;
            expect(patched.data.x).toBe(1);
        });

        it("SM32: createPatch returns null if patchFn produces no changes", () => {
            const success = getSuccess();
            const result = success.createPatch(() => {
                // No changes
            });
            expect(result).toBeNull();
        });

        it("SM33: finishPatch('committed', patch) applies patch permanently", () => {
            const success = getSuccess();
            const result = success.createPatch((d) => {
                d.x = 10;
            });
            expect(result).not.toBeNull();

            const patched = result!.machine as MachineSuccess<TestArgs, { name: string; x?: number }>;
            const patch = patched.patchState!.patches[0];

            const committed = patched.finishPatch("committed", patch);
            expect(committed.status).toBe("success");
            const committedSuccess = committed as unknown as MachineSuccess<TestArgs, { name: string; x?: number }>;
            expect(committedSuccess.data.x).toBe(10);
            // No more pending patches → patchState null
            expect(committedSuccess.patchState).toBeNull();
        });

        it("SM34: finishPatch('aborted', patch) rolls back patch", () => {
            const success = getSuccess();
            const result = success.createPatch((d) => {
                d.x = 10;
            });
            expect(result).not.toBeNull();

            const patched = result!.machine as MachineSuccess<TestArgs, { name: string; x?: number }>;
            const patch = patched.patchState!.patches[0];

            const aborted = patched.finishPatch("aborted", patch);
            expect(aborted.status).toBe("success");
            const abortedSuccess = aborted as unknown as MachineSuccess<TestArgs, { name: string; x?: number }>;
            expect(abortedSuccess.data).toEqual({ name: "data" });
            expect(abortedSuccess.patchState).toBeNull();
        });

        it("SM35: abortAllPendingPatches() reverts all pending patches", () => {
            let machine: MachineSuccess<TestArgs, { name: string; x?: number; y?: number; z?: number }> = Machine.idle<
                TestArgs,
                { name: string; x?: number; y?: number; z?: number }
            >()
                .start({ id: 1 })
                .successHappened({ name: "data" });

            // Create 3 patches
            const r1 = machine.createPatch((d) => {
                d.x = 1;
            });
            machine = r1!.machine as typeof machine;
            const r2 = machine.createPatch((d) => {
                d.y = 2;
            });
            machine = r2!.machine as typeof machine;
            const r3 = machine.createPatch((d) => {
                d.z = 3;
            });
            machine = r3!.machine as typeof machine;

            expect(machine.patchState!.patches).toHaveLength(3);

            const result = machine.abortAllPendingPatches();
            const reverted = result as unknown as MachineSuccess<
                TestArgs,
                { name: string; x?: number; y?: number; z?: number }
            >;
            expect(reverted.data).toEqual({ name: "data" });
            expect(reverted.patchState).toBeNull();
        });

        it("SM36: Immutability: createPatch returns new instance", () => {
            const a = getSuccess();
            const result = a.createPatch((d) => {
                d.x = 1;
            });
            expect(result).not.toBeNull();
            const b = result!.machine;
            expect(a).not.toBe(b);
            expect(a.data).not.toBe(b.data);
        });
    });
});
