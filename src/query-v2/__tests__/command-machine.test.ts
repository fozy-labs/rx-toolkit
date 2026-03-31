import { CommandError } from "@/query-v2/core/machines/CommandError";
import { CommandIdle } from "@/query-v2/core/machines/CommandIdle";
import { CommandLoading } from "@/query-v2/core/machines/CommandLoading";
import { CommandSuccess } from "@/query-v2/core/machines/CommandSuccess";

type TArgs = { id: number };
type TData = { name: string };

describe("Command Machine", () => {
    // ── T01: CommandIdle has status "idle", args/data/error null ──
    it("T01: CommandIdle has status 'idle' with args/data/error null", () => {
        const idle = new CommandIdle<TArgs, TData>();

        expect(idle.status).toBe("idle");
        expect(idle.args).toBeNull();
        expect(idle.data).toBeNull();
        expect(idle.error).toBeNull();
        expect(idle.state).toEqual({ status: "idle", args: null, data: null, error: null });
    });

    // ── T02: idle.start(args) → CommandLoading with correct args ──
    it("T02: idle.start(args) returns CommandLoading with correct args", () => {
        const idle = new CommandIdle<TArgs, TData>();
        const loading = idle.start({ id: 1 });

        expect(loading).toBeInstanceOf(CommandLoading);
        expect(loading.status).toBe("loading");
        expect(loading.args).toEqual({ id: 1 });
        expect(loading.data).toBeNull();
        expect(loading.error).toBeNull();
    });

    // ── T03: loading.successHappened(data) → CommandSuccess with data ──
    it("T03: loading.successHappened(data) returns CommandSuccess with data", () => {
        const loading = new CommandLoading<TArgs, TData>({ id: 1 });
        const success = loading.successHappened({ name: "test" });

        expect(success).toBeInstanceOf(CommandSuccess);
        expect(success.status).toBe("success");
        expect(success.args).toEqual({ id: 1 });
        expect(success.data).toEqual({ name: "test" });
        expect(success.error).toBeNull();
    });

    // ── T04: loading.errorHappened(err) → CommandError with error ──
    it("T04: loading.errorHappened(err) returns CommandError with error", () => {
        const loading = new CommandLoading<TArgs, TData>({ id: 1 });
        const err = new Error("something failed");
        const errorState = loading.errorHappened(err);

        expect(errorState).toBeInstanceOf(CommandError);
        expect(errorState.status).toBe("error");
        expect(errorState.args).toEqual({ id: 1 });
        expect(errorState.data).toBeNull();
        expect(errorState.error).toBe(err);
    });

    // ── T05: success.start(newArgs) → CommandLoading ──
    it("T05: success.start(newArgs) returns CommandLoading with new args", () => {
        const success = new CommandSuccess<TArgs, TData>({ id: 1 }, { name: "test" }, null);
        const loading = success.start({ id: 2 });

        expect(loading).toBeInstanceOf(CommandLoading);
        expect(loading.status).toBe("loading");
        expect(loading.args).toEqual({ id: 2 });
    });

    // ── T06: error.start(newArgs) → CommandLoading ──
    it("T06: error.start(newArgs) returns CommandLoading with new args", () => {
        const errorState = new CommandError<TArgs, TData>({ id: 1 }, new Error("fail"));
        const loading = errorState.start({ id: 3 });

        expect(loading).toBeInstanceOf(CommandLoading);
        expect(loading.status).toBe("loading");
        expect(loading.args).toEqual({ id: 3 });
    });

    // ── T07: CommandSuccess stores patchState ──
    it("T07: CommandSuccess stores patchState when provided", () => {
        const patchState = {
            originalData: { name: "original" },
            patches: [],
            isConsistencyViolation: false,
        };
        const success = new CommandSuccess<TArgs, TData>({ id: 1 }, { name: "test" }, patchState);

        expect(success.patchState).toBe(patchState);
        expect(success.state.patchState).toBe(patchState);
    });

    it("T07b: CommandSuccess stores null patchState", () => {
        const success = new CommandSuccess<TArgs, TData>({ id: 1 }, { name: "test" }, null);

        expect(success.patchState).toBeNull();
        expect(success.state.patchState).toBeNull();
    });

    // ── T08: Verify method availability ──
    it("T08: CommandIdle has no successHappened/errorHappened methods", () => {
        const idle = new CommandIdle<TArgs, TData>();

        expect((idle as any).successHappened).toBeUndefined();
        expect((idle as any).errorHappened).toBeUndefined();
    });

    it("T08b: CommandError has no successHappened method", () => {
        const errorState = new CommandError<TArgs, TData>({ id: 1 }, new Error("fail"));

        expect((errorState as any).successHappened).toBeUndefined();
    });
});
