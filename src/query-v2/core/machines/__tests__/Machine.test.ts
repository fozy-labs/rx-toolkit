import { Machine } from "@/query-v2/core/machines/Machine";
import { MachineError } from "@/query-v2/core/machines/MachineError";
import { MachinePending } from "@/query-v2/core/machines/MachinePending";
import { MachineRefreshing } from "@/query-v2/core/machines/MachineRefreshing";
import { MachineSuccess } from "@/query-v2/core/machines/MachineSuccess";

type TestArgs = { id: number };
type TestData = { name: string };

describe("Machine State Transitions", () => {
    // === MachinePending ===

    describe("MachinePending", () => {
        const getPending = () => Machine.pending<TestArgs, TestData>({ id: 1 });

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

        it("SM08: Pending preserves args from start", () => {
            const pending = Machine.pending<TestArgs, TestData>({ id: 5 });
            expect(pending.args).toEqual({ id: 5 });
        });

        it("SM09: Pending has no patchState", () => {
            const pending = getPending();
            expect(pending.state).not.toHaveProperty("patchState");
        });
    });

    // === MachineSuccess ===

    describe("MachineSuccess", () => {
        const getSuccess = () => Machine.pending<TestArgs, TestData>({ id: 1 }).successHappened({ name: "test" });

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
            const pending = Machine.pending<TestArgs, TestData>({ id: 1 });
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

        it("SM19: Error preserves error value", () => {
            const err = new Error("specific error");
            const pending = Machine.pending<TestArgs, TestData>({ id: 1 });
            const error = pending.errorHappened(err);
            expect(error.error).toBe(err);
        });
    });

    // === MachineRefreshing ===

    describe("MachineRefreshing", () => {
        const getRefreshing = () => {
            const success = Machine.pending<TestArgs, TestData>({ id: 1 }).successHappened({ name: "old" });
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

        it("SM23: Refreshing preserves stale data during background refetch", () => {
            const success = Machine.pending<TestArgs, TestData>({ id: 1 }).successHappened({ name: "stale" });
            const refreshing = success.invalidate();
            expect(refreshing.data).toEqual({ name: "stale" });
        });

        it("SM24: Refreshing preserves patches from success state", () => {
            const success = Machine.pending<TestArgs, { name: string; x?: number }>({ id: 1 }).successHappened({
                name: "data",
            });
            const patched = success.createPatch((d: { name: string; x?: number }) => {
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
            const success = Machine.pending<TestArgs, TestData>({ id: 1 }).successHappened({ name: "round-trip" });
            const fromSuccess = Machine.fromSnapshot<TestArgs, TestData>(success.state);
            expect(fromSuccess).toBeInstanceOf(MachineSuccess);
            expect((fromSuccess as MachineSuccess<TestArgs, TestData>).data).toEqual({ name: "round-trip" });
        });
    });

    // === MachineWithData (Patcher integration) ===

    describe("MachineWithData (Patcher integration)", () => {
        const getSuccess = () =>
            Machine.pending<TestArgs, { name: string; x?: number }>({ id: 1 }).successHappened({ name: "data" });

        it("SM31: createPatch(patchFn) returns { machine, patchHandle }", () => {
            const success = getSuccess();
            const result = success.createPatch((d: { name: string; x?: number }) => {
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
            const result = success.createPatch((d: { name: string; x?: number }) => {
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
            const result = success.createPatch((d: { name: string; x?: number }) => {
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
            let machine: MachineSuccess<TestArgs, { name: string; x?: number; y?: number; z?: number }> =
                Machine.pending<TestArgs, { name: string; x?: number; y?: number; z?: number }>({
                    id: 1,
                }).successHappened({ name: "data" });

            // Create 3 patches
            const r1 = machine.createPatch((d: { name: string; x?: number; y?: number; z?: number }) => {
                d.x = 1;
            });
            machine = r1!.machine as typeof machine;
            const r2 = machine.createPatch((d: { name: string; x?: number; y?: number; z?: number }) => {
                d.y = 2;
            });
            machine = r2!.machine as typeof machine;
            const r3 = machine.createPatch((d: { name: string; x?: number; y?: number; z?: number }) => {
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
            const result = a.createPatch((d: { name: string; x?: number }) => {
                d.x = 1;
            });
            expect(result).not.toBeNull();
            const b = result!.machine;
            expect(a).not.toBe(b);
            expect(a.data).not.toBe(b.data);
        });
    });

    // === lastError on MachineSuccess ===

    describe("lastError", () => {
        // ── T26: MachineRefreshing.errorHappened(error) → MachineSuccess with lastError ──
        it("T26: refreshing.errorHappened(error) → MachineSuccess with lastError", () => {
            const success = Machine.pending<TestArgs, TestData>({ id: 1 }).successHappened({ name: "old" });
            const refreshing = success.invalidate();
            const err = new Error("fail");

            const result = refreshing.errorHappened(err);

            expect(result).toBeInstanceOf(MachineSuccess);
            expect(result.status).toBe("success");
            expect(result.data).toEqual({ name: "old" });
            expect(result.lastError).toBe(err);
        });

        // ── T27: MachineRefreshing.successHappened(data) → MachineSuccess without lastError ──
        it("T27: refreshing.successHappened(data) → MachineSuccess without lastError", () => {
            const success = Machine.pending<TestArgs, TestData>({ id: 1 }).successHappened({ name: "old" });
            const refreshing = success.invalidate();

            const result = refreshing.successHappened({ name: "new" });

            expect(result).toBeInstanceOf(MachineSuccess);
            expect(result.lastError).toBeUndefined();
        });

        // ── T28: MachineSuccess.cloneWith() propagates lastError ──
        it("T28: cloneWith propagates lastError", () => {
            const success = Machine.pending<TestArgs, TestData>({ id: 1 }).successHappened({ name: "old" });
            const refreshing = success.invalidate();
            const withError = refreshing.errorHappened(new Error("bg fail"));

            expect(withError.lastError).toBeInstanceOf(Error);

            // createPatch calls cloneWith internally
            const patchResult = withError.createPatch((d: TestData) => {
                d.name = "patched";
            });
            expect(patchResult).not.toBeNull();
            const patched = patchResult!.machine as MachineSuccess<TestArgs, TestData>;
            expect(patched.lastError).toBeInstanceOf(Error);
            expect((patched.lastError as Error).message).toBe("bg fail");
        });

        // ── T29: Initial MachineSuccess (from fetch) has no lastError ──
        it("T29: initial MachineSuccess has no lastError", () => {
            const success = Machine.pending<TestArgs, TestData>({ id: 1 }).successHappened({ name: "fresh" });

            expect(success).toBeInstanceOf(MachineSuccess);
            expect(success.lastError).toBeUndefined();
        });
    });
});
