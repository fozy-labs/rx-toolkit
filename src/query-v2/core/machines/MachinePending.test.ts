import { NO_VALUE } from "@/query-v2/lib/NO_VALUE";

import { MachineError } from "./MachineError";
import { MachineIdle } from "./MachineIdle";
import { MachinePending } from "./MachinePending";
import { MachineSuccess } from "./MachineSuccess";

describe("MachinePending", () => {
    // M2: MachinePending → MachineSuccess via successHappened(data)
    it("M2: successHappened(data) transitions to MachineSuccess", () => {
        const pending = MachinePending.create({ id: 1 });
        const success = pending.successHappened({ name: "Alice" });

        expect(success).toBeInstanceOf(MachineSuccess);
        expect(success.state.status).toBe("success");
        expect(success.state.data).toEqual({ name: "Alice" });
        expect(success.state.args).toEqual({ id: 1 });
        expect(success.state.updatedAt).toBeTypeOf("number");
        expect(success.state.error).toBeNull();
    });

    // M3: MachinePending → MachineError via errorHappened(error)
    it("M3: errorHappened(error) transitions to MachineError", () => {
        const pending = MachinePending.create({ id: 1 });
        const error = pending.errorHappened(new Error("404"));

        expect(error).toBeInstanceOf(MachineError);
        expect(error.state.status).toBe("error");
        expect(error.state.error).toBeInstanceOf(Error);
        expect((error.state.error as Error).message).toBe("404");
        expect(error.state.args).toEqual({ id: 1 });
    });

    it("reset() transitions to MachineIdle", () => {
        const pending = MachinePending.create({ id: 1 });
        const idle = pending.reset();

        expect(idle).toBeInstanceOf(MachineIdle);
        expect(idle.state.status).toBe("idle");
    });

    it("create() produces correct pending state", () => {
        const pending = MachinePending.create({ id: 1 });
        expect(pending.state.status).toBe("pending");
        expect(pending.state.args).toEqual({ id: 1 });
        expect(pending.state.data).toBeNull();
        expect(pending.state.error).toBeNull();
        expect(pending.state.updatedAt).toBeNull();
        expect(pending.state.originalData).toBe(NO_VALUE);
    });
});
