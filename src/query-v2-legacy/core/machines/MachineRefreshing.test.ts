import { MachineIdle } from "./MachineIdle";
import { MachineRefreshing } from "./MachineRefreshing";
import { MachineSuccess } from "./MachineSuccess";

describe("MachineRefreshing", () => {
    const staleData = { name: "Alice" };
    const args = { id: 1 };
    const updatedAt = 1000;

    // M7: MachineRefreshing → MachineSuccess on success
    it("M7: successHappened(freshData) transitions to MachineSuccess with fresh data", () => {
        const refreshing = MachineRefreshing.create(staleData, args, updatedAt);
        const freshData = { name: "Bob" };
        const success = refreshing.successHappened(freshData);

        expect(success).toBeInstanceOf(MachineSuccess);
        expect(success.state.status).toBe("success");
        expect(success.state.data).toEqual(freshData);
        expect(success.state.args).toEqual(args);
        expect(success.state.updatedAt).toBeTypeOf("number");
        expect(success.state.updatedAt).not.toBe(updatedAt); // Fresh timestamp
    });

    // M8: MachineRefreshing → MachineSuccess on error (stale data preserved) — ADR-2
    it("M8: errorHappened() transitions to MachineSuccess with stale data preserved", () => {
        const refreshing = MachineRefreshing.create(staleData, args, updatedAt);
        const result = refreshing.errorHappened(new Error("500"));

        expect(result).toBeInstanceOf(MachineSuccess);
        expect(result.state.status).toBe("success");
        expect(result.state.data).toEqual(staleData);
        expect(result.state.updatedAt).toBe(updatedAt); // Same timestamp (stale)
    });

    // M9: MachineRefreshing → MachineIdle via reset()
    it("M9: reset() transitions to MachineIdle", () => {
        const refreshing = MachineRefreshing.create(staleData, args, updatedAt);
        const idle = refreshing.reset();

        expect(idle).toBeInstanceOf(MachineIdle);
        expect(idle.state.status).toBe("idle");
    });

    it("create() produces correct refreshing state", () => {
        const refreshing = MachineRefreshing.create(staleData, args, updatedAt);
        expect(refreshing.state.status).toBe("refreshing");
        expect(refreshing.state.data).toEqual(staleData);
        expect(refreshing.state.args).toEqual(args);
        expect(refreshing.state.updatedAt).toBe(updatedAt);
        expect(refreshing.state.error).toBeNull();
    });

    it("transitions return new instances (immutability)", () => {
        const refreshing = MachineRefreshing.create(staleData, args, updatedAt);
        const success = refreshing.successHappened({ name: "Bob" });
        const idle = refreshing.reset();

        // Original unchanged
        expect(refreshing.state.status).toBe("refreshing");
        expect(refreshing.state.data).toEqual(staleData);

        expect(success).not.toBe(refreshing);
        expect(idle).not.toBe(refreshing);
    });
});
