import { SharedOptions } from "@/common/options/SharedOptions";
import { SYMBOL_DISPOSE } from "@/signals/base/disposeSymbol";
import { Signal } from "@/signals/signals/Signal";

import { assign } from "./actions";
import { unstable_createMachine as createMachine } from "./createMachine";
import { unstable_MachineSignal as MachineSignal } from "./MachineSignal";
import type { MachineStateSignal } from "./types";

function trafficLight() {
    return createMachine({
        id: "trafficLight",
        initial: "green",
        context: { cycles: 0 },
        states: {
            green: { on: { TIMER: "yellow" } },
            yellow: { on: { TIMER: "red" } },
            red: {
                on: { TIMER: { target: "green", actions: assign({ cycles: ({ context }) => context.cycles + 1 }) } },
            },
        },
    });
}

beforeEach(() => {
    SharedOptions.reset();
});

afterEach(() => {
    SharedOptions.reset();
    vi.useRealTimers();
});

describe("MachineSignal.state()", () => {
    it("returns a callable signal whose call, get() and peek() read the snapshot", () => {
        const light$ = MachineSignal.state(trafficLight());
        expect(typeof light$).toBe("function");
        expect(light$().value).toBe("green");
        expect(light$.get()).toBe(light$());
        expect(light$.peek()).toBe(light$());
        expect(light$().status).toBe("active");
        light$.dispose();
    });

    it("exposes the definition and a live engine status", () => {
        const definition = trafficLight();
        const light$ = MachineSignal.state(definition, { autoStart: false });
        expect(light$.definition).toBe(definition);
        expect(light$.status).toBe("idle");
        light$.start();
        expect(light$.status).toBe("running");
        light$.stop();
        expect(light$.status).toBe("stopped");
        light$.dispose();
        expect(light$.status).toBe("disposed");
    });

    it("send(), matches() and can() delegate to the engine", () => {
        const light$ = MachineSignal.state(trafficLight());
        expect(light$.matches("green")).toBe(true);
        expect(light$.can({ type: "TIMER" })).toBe(true);
        expect(light$.can({ type: "NOPE" })).toBe(false);
        light$.send({ type: "TIMER" });
        expect(light$.matches("yellow")).toBe(true);
        expect(light$().value).toBe("yellow");
        light$.send({ type: "TIMER" });
        light$.send({ type: "TIMER" });
        expect(light$().context).toEqual({ cycles: 1 });
        light$.dispose();
    });

    it("obs emits exactly one snapshot per macrostep and completes on dispose", () => {
        const light$ = MachineSignal.state(trafficLight());
        const values: unknown[] = [];
        let completed = false;
        const subscription = light$.obs.subscribe({
            next: (snapshot) => values.push(snapshot.value),
            complete: () => (completed = true),
        });
        light$.send({ type: "TIMER" });
        light$.send({ type: "UNKNOWN" });
        expect(values).toEqual(["green", "yellow"]);
        light$.dispose();
        expect(completed).toBe(true);
        subscription.unsubscribe();
    });

    it("tracks the snapshot inside Signal.compute", () => {
        const light$ = MachineSignal.state(trafficLight());
        const label = Signal.compute(() => `light is ${String(light$().value)}`);
        const seen: string[] = [];
        const effect = Signal.effect(() => {
            seen.push(label());
        });
        expect(seen).toEqual(["light is green"]);
        light$.send({ type: "TIMER" });
        expect(seen).toEqual(["light is green", "light is yellow"]);
        expect(label()).toBe("light is yellow");
        effect.unsubscribe();
        label.dispose();
        light$.dispose();
    });

    it("tracks the snapshot inside Signal.effect (call and get(), not peek())", () => {
        const light$ = MachineSignal.state(trafficLight());
        const viaCall: string[] = [];
        const viaGet: string[] = [];
        const viaPeek: string[] = [];
        const callEffect = Signal.effect(() => {
            viaCall.push(String(light$().value));
        });
        const getEffect = Signal.effect(() => {
            viaGet.push(String(light$.get().value));
        });
        const peekEffect = Signal.effect(() => {
            viaPeek.push(String(light$.peek().value));
        });
        light$.send({ type: "TIMER" });
        expect(viaCall).toEqual(["green", "yellow"]);
        expect(viaGet).toEqual(["green", "yellow"]);
        expect(viaPeek).toEqual(["green"]);
        callEffect.unsubscribe();
        getEffect.unsubscribe();
        peekEffect.unsubscribe();
        light$.dispose();
    });

    it("send() from a Signal.effect reacting to the snapshot is processed within the same burst", () => {
        const light$ = MachineSignal.state(trafficLight());
        const seen: string[] = [];
        const effect = Signal.effect(() => {
            const value = String(light$().value);
            seen.push(value);
            if (value === "yellow") light$.send({ type: "TIMER" });
        });
        light$.send({ type: "TIMER" });
        expect(light$().value).toBe("red");
        expect(seen).toEqual(["green", "yellow", "red"]);
        effect.unsubscribe();
        light$.dispose();
    });

    it("stop() / start() from a Signal.effect are deferred to the end of the burst", () => {
        const light$ = MachineSignal.state(trafficLight());
        const effect = Signal.effect(() => {
            const snapshot = light$();
            if (snapshot.value === "yellow") light$.stop();
            if (snapshot.status === "stopped") light$.start();
        });
        light$.send({ type: "TIMER" });
        // yellow -> stopped (effect) -> restarted from scratch (effect)
        expect(light$.status).toBe("running");
        expect(light$()).toMatchObject({ status: "active", value: "green" });
        effect.unsubscribe();
        light$.dispose();
    });

    it("accepts a string as the Redux DevTools key and forwards object options", () => {
        const keys: string[] = [];
        SharedOptions.DEVTOOLS = {
            state: (key: string) => {
                keys.push(key);
                return () => undefined;
            },
        };
        const byString = MachineSignal.state(trafficLight(), "lights/main");
        const byObject = MachineSignal.state(trafficLight(), { key: "lights/second" });
        const byDefault = MachineSignal.state(trafficLight());
        const disabled = MachineSignal.state(trafficLight(), { isDisabled: true });
        expect(keys).toEqual(["lights/main", "lights/second", "Statechart/trafficLight"]);
        byString.dispose();
        byObject.dispose();
        byDefault.dispose();
        disabled.dispose();
    });

    it("forwards the inspector, clock and onError options", () => {
        vi.useFakeTimers();
        const calls: string[] = [];
        const onError = vi.fn();
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: { a: { after: { 100: "b" } }, b: { on: { GO: { actions: "explode" } } } },
            },
            {
                actions: {
                    explode: () => {
                        throw new Error("x");
                    },
                },
            },
        );
        const machine$ = MachineSignal.state(definition, {
            inspector: {
                actor: () => ({
                    event: (event) => {
                        calls.push(event.type);
                    },
                    snapshot: () => undefined,
                    stop: () => {
                        calls.push("stop");
                    },
                }),
            },
            onError,
        });
        vi.advanceTimersByTime(100);
        expect(machine$().value).toBe("b");
        machine$.send({ type: "GO" });
        expect(onError).toHaveBeenCalledOnce();
        expect(machine$().status).toBe("error");
        machine$.dispose();
        expect(calls).toEqual(["xstate.init", "xstate.after.100.m.a", "GO", "stop"]);
    });

    it("dispose() is idempotent and available as Symbol.dispose", () => {
        const light$ = MachineSignal.state(trafficLight());
        light$[SYMBOL_DISPOSE]();
        expect(light$.status).toBe("disposed");
        expect(() => light$.dispose()).not.toThrow();
        expect(() => light$.start()).toThrow("Statechart has been disposed");
    });

    it("works with `using`-style disposal through the DisposableSignal contract", () => {
        const light$: MachineStateSignal<{ cycles: number }, { type: string }> = MachineSignal.state(trafficLight());
        const disposable: Disposable = light$;
        disposable[SYMBOL_DISPOSE]();
        expect(light$.status).toBe("disposed");
    });

    it("throws the lazy implementation check error from the facade too", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: { entry: "missing" } } });
        expect(() => MachineSignal.state(definition)).toThrow("action 'missing' is not implemented");
    });
});
