/**
 * Type-level test: the library's `MachineStateSignal` of the proposal's
 * `square` and `trafficLight` definitions is assignable to `VizMachine`
 * without casts, and `<StatechartViz machine={...} />` typechecks. Verified
 * by `npm run ts-check`; vitest only asserts that the module loads. The
 * generated files of the library's test tree are referenced through
 * `typeof import(...)`, which is erased at runtime.
 */
import { MachineSignal, Signal } from "@fozy-labs/rx-toolkit";
import { describe, expect, it } from "vitest";

import { StatechartViz } from "../StatechartViz";
import type { MachineConfigLike, VizMachine } from "../types";

declare const squareDefinition: typeof import("@/statechart/__tests__/proposal/square.generated").definition;
declare const trafficLightDefinition: typeof import("@/statechart/__tests__/proposal/trafficLight.generated").definition;

type SquareContext = import("@/statechart/__tests__/proposal/square.generated").Context;
type SquareEvents = import("@/statechart/__tests__/proposal/square.generated").Events;

/** Never called: every statement is a compile-time assertion. */
function assignments() {
    const square$ = MachineSignal.state(squareDefinition);
    const light$ = MachineSignal.state(trafficLightDefinition);

    const untyped: VizMachine[] = [square$, light$];
    const typed: VizMachine<SquareContext, SquareEvents> = square$;
    const source: string | undefined = square$.definition.source;
    const config: MachineConfigLike = light$.definition.config;
    const elements = [<StatechartViz machine={square$} />, <StatechartViz machine={light$} title="Traffic light" />];

    // @ts-expect-error a plain state signal has no machine API
    const notAMachine: VizMachine = Signal.state(0);

    return { untyped, typed, source, config, elements, notAMachine };
}

describe("VizMachine", () => {
    it("is satisfied by the library's MachineStateSignal (checked by tsc)", () => {
        expect(typeof assignments).toBe("function");
    });
});
