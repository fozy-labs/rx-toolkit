import { SignalCycleError } from "@/signals/base/SignalCycleError";

import { FormConfigError } from "../FormConfigError";

import { errorMessage, guard, outcomeEquals } from "./guard";

describe("guard()", () => {
    it("returns the value, or the error a callback threw", () => {
        const error = new Error("boom");
        expect(guard(() => 1, "x")).toEqual({ ok: true, value: 1 });
        expect(
            guard(() => {
                throw error;
            }, "x"),
        ).toEqual({ ok: false, error });
    });

    it("passes a FormConfigError through", () => {
        const error = new FormConfigError("a", "bad");
        expect(() =>
            guard(() => {
                throw error;
            }, "x"),
        ).toThrow(error);
    });

    it("turns a signal cycle into a FormConfigError at the callback", () => {
        const run = () =>
            guard(() => {
                throw new SignalCycleError(["A", "B", "A"]);
            }, "fields.a.validate");
        expect(run).toThrow(FormConfigError);
        expect(run).toThrow("fields.a.validate: reads a signal that depends on its own result (A → B → A)");
    });
});

describe("outcomeEquals()", () => {
    it("compares values and errors by identity", () => {
        const error = new Error("e");
        expect(outcomeEquals({ ok: true, value: 1 }, { ok: true, value: 1 })).toBe(true);
        expect(outcomeEquals({ ok: true, value: {} }, { ok: true, value: {} })).toBe(false);
        expect(outcomeEquals({ ok: false, error }, { ok: false, error })).toBe(true);
        expect(outcomeEquals({ ok: true, value: error }, { ok: false, error })).toBe(false);
    });
});

describe("errorMessage()", () => {
    it("takes the message of an Error, else its name, else the string form", () => {
        expect(errorMessage(new Error("m"))).toBe("m");
        expect(errorMessage(new TypeError())).toBe("TypeError");
        expect(errorMessage("text")).toBe("text");
        expect(errorMessage(42)).toBe("42");
    });
});
