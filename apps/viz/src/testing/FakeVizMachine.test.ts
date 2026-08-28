import { describe, expect, it } from "vitest";

import type { VizSnapshot } from "../types";

import { createFakeVizMachine, type FakeClock } from "./FakeVizMachine";
import { parallelFixture, squareFixture, trafficLightFixture } from "./fixtures";

function createTestClock() {
    let now = 0;
    let seq = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();

    const clock: FakeClock = {
        setTimeout: (fn, ms) => {
            const id = ++seq;
            timers.set(id, { at: now + ms, fn });
            return id;
        },
        clearTimeout: (handle) => {
            timers.delete(handle as number);
        },
    };

    const advance = (ms: number) => {
        const until = now + ms;
        for (;;) {
            const due = [...timers.entries()]
                .filter(([, timer]) => timer.at <= until)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!due) break;
            timers.delete(due[0]);
            now = due[1].at;
            due[1].fn();
        }
        now = until;
    };

    return { clock, advance, pending: () => timers.size };
}

describe("createFakeVizMachine", () => {
    describe("trafficLight", () => {
        it("starts in the initial state with the fixture context", () => {
            const machine = createFakeVizMachine(trafficLightFixture);
            expect(machine()).toEqual({ status: "active", value: "off", context: { power: true, retries: 0 } });
            expect(machine.status).toBe("running");
            expect(machine.definition.id).toBe("trafficLight");
            expect(machine.definition.source).toBe(trafficLightFixture.source);
            expect(machine.definition.toMermaid()).toBe(trafficLightFixture.source);
        });

        it("POWER_ON enters the compound's initial child", () => {
            const machine = createFakeVizMachine(trafficLightFixture, { clock: createTestClock().clock });
            expect(machine.can({ type: "POWER_ON" })).toBe(true);
            machine.send({ type: "POWER_ON" });
            expect(machine().value).toEqual({ working: "green" });
            expect(machine.matches("working")).toBe(true);
            expect(machine.matches({ working: "green" })).toBe(true);
            expect(machine.matches({ working: "red" })).toBe(false);
        });

        it("ignores POWER_ON when the guard fails", () => {
            const machine = createFakeVizMachine({ ...trafficLightFixture, context: { power: false, retries: 0 } });
            expect(machine.can({ type: "POWER_ON" })).toBe(false);
            machine.send({ type: "POWER_ON" });
            expect(machine().value).toBe("off");
        });

        it("ignores FAULT while green", () => {
            const machine = createFakeVizMachine(trafficLightFixture, { clock: createTestClock().clock });
            machine.send({ type: "POWER_ON" });
            expect(machine.can({ type: "FAULT" })).toBe(false);
            machine.send({ type: "FAULT" });
            expect(machine().value).toEqual({ working: "green" });
        });

        it("runs delayed transitions on the clock and finishes through $final and onDone", () => {
            const { clock, advance, pending } = createTestClock();
            const machine = createFakeVizMachine(trafficLightFixture, { clock });
            machine.send({ type: "POWER_ON" });
            expect(pending()).toBe(1);

            advance(2999);
            expect(machine().value).toEqual({ working: "green" });
            advance(1);
            expect(machine().value).toEqual({ working: "yellow" });
            advance(1000);
            expect(machine().value).toEqual({ working: "red" });
            expect(pending()).toBe(1);

            expect(machine.can({ type: "FAULT" })).toBe(true);
            machine.send({ type: "FAULT" });
            expect(machine().value).toBe("broken");
            expect(machine().status).toBe("active");
            expect(pending()).toBe(0);
        });

        it("takes the ancestor transition POWER_OFF from a nested state and cancels its timers", () => {
            const { clock, pending } = createTestClock();
            const machine = createFakeVizMachine(trafficLightFixture, { clock });
            machine.send({ type: "POWER_ON" });
            expect(pending()).toBe(1);
            machine.send({ type: "POWER_OFF" });
            expect(machine().value).toBe("off");
            expect(pending()).toBe(0);
        });

        it("RESET runs the retry action as an immutable update", () => {
            const { clock, advance } = createTestClock();
            const machine = createFakeVizMachine(trafficLightFixture, { clock });
            machine.send({ type: "POWER_ON" });
            advance(4000);
            machine.send({ type: "FAULT" });
            const before = machine();
            expect(before.value).toBe("broken");

            machine.send({ type: "RESET" });
            const after = machine();
            expect(after.value).toBe("off");
            expect(after.context).toEqual({ power: true, retries: 1 });
            expect(before.context).toEqual({ power: true, retries: 0 });
            expect(after).not.toBe(before);
            expect(after.context).not.toBe(before.context);
        });
    });

    describe("square", () => {
        it("takes the first candidate whose guard passes", () => {
            const machine = createFakeVizMachine(squareFixture);
            expect(machine().value).toBe("idle");
            machine.send({ type: "SQUARE", value: 12 } as never);
            expect(machine().value).toBe("done");
            expect(machine().context).toEqual({ result: 144, error: null });

            machine.send({ type: "RESET" });
            expect(machine().value).toBe("idle");
            expect(machine().context).toEqual({ result: null, error: null });
        });

        it("falls through to the unguarded candidate", () => {
            const machine = createFakeVizMachine(squareFixture);
            machine.send({ type: "SQUARE", value: NaN } as never);
            expect(machine().value).toBe("error");
            expect(machine().context).toEqual({ result: null, error: "not a finite number" });

            machine.send({ type: "RESET" });
            expect(machine().value).toBe("idle");
            expect(machine().context).toEqual({ result: null, error: null });
        });
    });

    describe("parallel", () => {
        it("enters every region and advances them independently", () => {
            const machine = createFakeVizMachine(parallelFixture);
            expect(machine().value).toBe("idle");
            machine.send({ type: "START" });
            expect(machine().value).toEqual({ p: { $0: "a", $1: "c" } });

            machine.send({ type: "NEXT_A" });
            expect(machine().value).toEqual({ p: { $0: "b", $1: "c" } });
            expect(machine.matches({ p: { $0: "b" } })).toBe(true);
            expect(machine.matches({ p: { $1: "d" } })).toBe(false);
            expect(machine.matches("p")).toBe(true);
        });

        it("fires onDone only when all regions are final", () => {
            const machine = createFakeVizMachine(parallelFixture);
            machine.send({ type: "START" });
            machine.send({ type: "NEXT_A" });
            machine.send({ type: "FIN_A" });
            expect(machine().value).toEqual({ p: { $0: "$final", $1: "c" } });
            expect(machine.can({ type: "FIN_A" })).toBe(false);

            machine.send({ type: "NEXT_C" });
            expect(machine().value).toEqual({ p: { $0: "$final", $1: "d" } });
            machine.send({ type: "FIN_C" });
            expect(machine().value).toBe("finished");
        });

        it("STOP leaves the parallel state from any region", () => {
            const machine = createFakeVizMachine(parallelFixture);
            machine.send({ type: "START" });
            machine.send({ type: "NEXT_C" });
            machine.send({ type: "STOP" });
            expect(machine().value).toBe("idle");
        });

        it("resolves the choice through always candidates", () => {
            const machine = createFakeVizMachine(parallelFixture);
            machine.send({ type: "START" });
            for (const type of ["NEXT_A", "FIN_A", "NEXT_C", "FIN_C"]) machine.send({ type });
            expect(machine().value).toBe("finished");
            machine.send({ type: "CHECK" });
            expect(machine().value).toBe("idle");

            const retrying = createFakeVizMachine({ ...parallelFixture, context: { ok: false } });
            retrying.send({ type: "START" });
            for (const type of ["NEXT_A", "FIN_A", "NEXT_C", "FIN_C"]) retrying.send({ type });
            retrying.send({ type: "CHECK" });
            expect(retrying().value).toEqual({ p: { $0: "a", $1: "c" } });
        });

        it("reaches the root final and reports done", () => {
            const machine = createFakeVizMachine(parallelFixture);
            machine.send({ type: "START" });
            for (const type of ["NEXT_A", "FIN_A", "NEXT_C", "FIN_C"]) machine.send({ type });
            machine.send({ type: "FINISH" });
            expect(machine()).toEqual({ status: "done", value: "$final", context: { ok: true } });
            expect(machine.can({ type: "START" })).toBe(false);
            machine.send({ type: "START" });
            expect(machine().value).toBe("$final");
        });
    });

    describe("lifecycle", () => {
        it("emits a snapshot on every change through obs", () => {
            const machine = createFakeVizMachine(trafficLightFixture, { clock: createTestClock().clock });
            const seen: VizSnapshot<unknown>[] = [];
            const subscription = machine.obs.subscribe((snapshot) => seen.push(snapshot));
            machine.send({ type: "POWER_ON" });
            machine.send({ type: "FAULT" });
            machine.send({ type: "POWER_OFF" });
            subscription.unsubscribe();
            expect(seen.map((snapshot) => snapshot.value)).toEqual(["off", { working: "green" }, "off"]);
        });

        it("stop cancels timers and ignores events", () => {
            const { clock, pending } = createTestClock();
            const machine = createFakeVizMachine(trafficLightFixture, { clock });
            machine.send({ type: "POWER_ON" });
            expect(pending()).toBe(1);
            machine.stop();
            expect(pending()).toBe(0);
            expect(machine.status).toBe("stopped");
            expect(machine().status).toBe("stopped");
            expect(machine().value).toEqual({ working: "green" });
            expect(machine.can({ type: "POWER_OFF" })).toBe(false);
            machine.send({ type: "POWER_OFF" });
            expect(machine().value).toEqual({ working: "green" });
        });

        it("start re-enters the initial configuration after stop", () => {
            const machine = createFakeVizMachine(trafficLightFixture, { clock: createTestClock().clock });
            machine.send({ type: "POWER_ON" });
            machine.stop();
            machine.start();
            expect(machine.status).toBe("running");
            expect(machine()).toEqual({ status: "active", value: "off", context: { power: true, retries: 0 } });
        });

        it("dispose completes the snapshot signal", () => {
            const machine = createFakeVizMachine(trafficLightFixture, { clock: createTestClock().clock });
            let completed = false;
            machine.obs.subscribe({ complete: () => (completed = true) });
            machine.dispose();
            expect(machine.status).toBe("disposed");
            expect(completed).toBe(true);
            machine.send({ type: "POWER_ON" });
            expect(machine().value).toBe("off");
        });

        it("autoStart: false waits for start()", () => {
            const machine = createFakeVizMachine(trafficLightFixture, { autoStart: false });
            expect(machine.status).toBe("idle");
            expect(machine().status).toBe("stopped");
            machine.send({ type: "POWER_ON" });
            expect(machine().value).toBe("off");
            machine.start();
            expect(machine.status).toBe("running");
            expect(machine().status).toBe("active");
        });
    });
});
