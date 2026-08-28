/**
 * The proposal's generated files (`trafficLight.generated.ts`,
 * `square.generated.ts`, sections «Конвертер», «Рантайм» and «Пример:
 * возведение в квадрат») compile against the library types as written and
 * behave as the proposal documents.
 */
import { MachineSignal, Signal, type MachineClock } from "@/index";

import { definition as square, type StateId as SquareStateId } from "./square.generated";
import { source, definition as trafficLight, type StateId as TrafficLightStateId } from "./trafficLight.generated";

/** Manual clock: `after` timers fire on `flush()`. */
function createManualClock(): MachineClock & { flush(): void } {
    const pending = new Map<number, () => void>();
    let id = 0;
    return {
        setTimeout: (callback) => {
            pending.set(++id, callback);
            return id;
        },
        clearTimeout: (handle) => {
            pending.delete(handle as number);
        },
        flush: () => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback());
        },
    };
}

describe("proposal examples", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("trafficLight.generated.ts", () => {
        it("keeps the verbatim source on the definition and renders the same structure from the config", () => {
            expect(trafficLight.source).toBe(source);
            expect(trafficLight.id).toBe("trafficLight");
            expect(trafficLight.toMermaid()).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine trafficLight",
                    '    %% @context initial: {"power":true,"retries":0}',
                    "    [*] --> off",
                    "    off --> working: POWER_ON [hasPower] / logStart",
                    "    working --> off: POWER_OFF",
                    "    working --> broken: done",
                    "    state working {",
                    "        [*] --> green",
                    "        green --> yellow: after 3000",
                    "        yellow --> red: after 1000 / warn",
                    "        red --> green: after 3000",
                    "        red --> [*]: FAULT",
                    "    }",
                    "    broken --> off: RESET / retry",
                    "",
                ].join("\n"),
            );
        });

        it("runs as documented: POWER_ON, the timers, FAULT -> $final -> onDone -> broken, RESET / retry", () => {
            const clock = createManualClock();
            const light$ = MachineSignal.state(trafficLight, { clock });

            expect(light$()).toMatchObject({ value: "off", context: { power: true, retries: 0 }, status: "active" });

            light$.send({ type: "POWER_ON" });
            expect(light$().value).toEqual({ working: "green" });
            expect(console.log).toHaveBeenCalledWith("start");
            expect(light$.matches("working.green" satisfies TrafficLightStateId)).toBe(true);
            expect(light$.matches({ working: "green" })).toBe(true);

            // FAULT is handled in `red` only.
            expect(light$.can({ type: "FAULT" })).toBe(false);
            light$.send({ type: "FAULT" });
            expect(light$().value).toEqual({ working: "green" });

            clock.flush(); // after 3000
            expect(light$().value).toEqual({ working: "yellow" });
            clock.flush(); // after 1000 / warn
            expect(light$().value).toEqual({ working: "red" });
            expect(console.warn).toHaveBeenCalledWith("yellow -> red");

            expect(light$.can({ type: "FAULT" })).toBe(true);
            light$.send({ type: "FAULT" }); // red -> $final -> onDone -> broken
            expect(light$().value).toBe("broken");

            light$.send({ type: "RESET" });
            expect(light$()).toMatchObject({ value: "off", context: { power: true, retries: 1 } });
            // `mutate` never touches the shared initial context.
            expect(trafficLight.config.context).toEqual({ power: true, retries: 0 });

            light$.dispose();
        });

        it("provide() overrides a guard for tests (XState idiom)", () => {
            const stub$ = MachineSignal.state(trafficLight.provide({ guards: { hasPower: () => false } }));
            expect(stub$.can({ type: "POWER_ON" })).toBe(false);
            stub$.send({ type: "POWER_ON" });
            expect(stub$().value).toBe("off");
            stub$.dispose();
        });
    });

    describe("square.generated.ts", () => {
        it("squares finite numbers, rejects NaN, and the context is an ordinary signal source", () => {
            const square$ = MachineSignal.state(square);
            const result$ = Signal.compute(() => square$().context.result);

            expect(square$()).toMatchObject({ value: "idle", context: { result: null, error: null } });

            square$.send({ type: "SQUARE", value: 12 });
            expect(result$()).toBe(144);
            expect(square$().value).toBe("done" satisfies SquareStateId);

            square$.send({ type: "RESET" });
            expect(square$().value).toBe("idle");
            expect(square$().context).toEqual({ result: null, error: null });

            square$.send({ type: "SQUARE", value: NaN });
            expect(square$().value).toBe("error");
            expect(square$().context).toEqual({ result: null, error: "not a finite number" });
            expect(result$()).toBeNull();

            // RESET from `error` clears the context again.
            square$.send({ type: "RESET" });
            expect(square$()).toMatchObject({ value: "idle", context: { result: null, error: null } });

            result$.dispose();
            square$.dispose();
        });
    });
});
