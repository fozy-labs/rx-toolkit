import { describe, expect, it } from "vitest";

import { parseTransitionLabel } from "./transitionLabel";

describe("parseTransitionLabel", () => {
    it("parses a bare event", () => {
        expect(parseTransitionLabel("POWER_OFF")).toEqual({
            raw: "POWER_OFF",
            trigger: { kind: "event", event: "POWER_OFF" },
            guard: undefined,
            actions: [],
        });
    });

    it("parses event, guard and actions", () => {
        expect(parseTransitionLabel("POWER_ON [hasPower] / logStart, retry")).toEqual({
            raw: "POWER_ON [hasPower] / logStart, retry",
            trigger: { kind: "event", event: "POWER_ON" },
            guard: "hasPower",
            actions: ["logStart", "retry"],
        });
    });

    it("parses after with milliseconds and with a delay name", () => {
        expect(parseTransitionLabel("after 3000").trigger).toEqual({ kind: "after", delay: "3000" });
        expect(parseTransitionLabel("after slow / warn")).toMatchObject({
            trigger: { kind: "after", delay: "slow" },
            actions: ["warn"],
        });
    });

    it("parses done", () => {
        expect(parseTransitionLabel("done").trigger).toEqual({ kind: "done" });
    });

    it("treats an empty label as always and a guard-only label as a guarded always", () => {
        expect(parseTransitionLabel("").trigger).toEqual({ kind: "always" });
        expect(parseTransitionLabel("  ").trigger).toEqual({ kind: "always" });
        expect(parseTransitionLabel("[ok]")).toMatchObject({ trigger: { kind: "always" }, guard: "ok" });
        expect(parseTransitionLabel("/ clear")).toMatchObject({ trigger: { kind: "always" }, actions: ["clear"] });
    });

    it("marks text outside the grammar as unknown", () => {
        expect(parseTransitionLabel("RESET [retries < 3]").trigger).toEqual({ kind: "unknown" });
        expect(parseTransitionLabel("a b").trigger).toEqual({ kind: "unknown" });
        expect(parseTransitionLabel("1st").trigger).toEqual({ kind: "unknown" });
    });
});
