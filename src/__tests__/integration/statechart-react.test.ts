// The React recipe of docs/statechart/README.md: an instance per component.
import { act, render } from "@testing-library/react";
import React from "react";

import { unstable_createMachine as createMachine, unstable_MachineSignal as MachineSignal } from "@/index";
import type { MachineClock, MachineStateSignal } from "@/index";
import { useSignal } from "@/react";

const h = React.createElement;

function manualClock() {
    const pending = new Map<number, () => void>();
    let id = 0;
    const clock: MachineClock = {
        setTimeout: (callback) => {
            pending.set(++id, callback);
            return id;
        },
        clearTimeout: (handle) => {
            pending.delete(handle as number);
        },
    };
    return { clock, pending };
}

const light = createMachine({
    id: "light",
    initial: "green",
    states: { green: { after: { 1000: "red" } }, red: { after: { 1000: "green" } } },
});

describe("statechart instance per component (README recipe)", () => {
    it("StrictMode: the instance runs while mounted and leaves nothing running after unmount", () => {
        const { clock, pending } = manualClock();
        const created: MachineStateSignal<object, { type: string }>[] = [];

        function TrafficLight() {
            const [light$] = React.useState(() => {
                const instance = MachineSignal.state(light, {
                    clock,
                    autoStart: false,
                    inspector: null,
                    isDisabled: true,
                });
                created.push(instance);
                return instance;
            });
            React.useEffect(() => {
                light$.start();
                return () => light$.stop();
            }, [light$]);
            const snapshot = useSignal(light$);
            return h("span", null, String(snapshot.value));
        }

        const view = render(h(React.StrictMode, null, h(TrafficLight)));
        expect(view.container.textContent).toBe("green");
        expect(created.filter((instance) => instance.status === "running")).toHaveLength(1);
        expect(pending.size).toBe(1);

        act(() => {
            const due = [...pending.values()];
            pending.clear();
            due.forEach((fire) => fire());
        });
        expect(view.container.textContent).toBe("red");
        expect(pending.size).toBe(1);

        view.unmount();
        expect(created.filter((instance) => instance.status === "running")).toHaveLength(0);
        expect(pending.size).toBe(0);
    });
});
