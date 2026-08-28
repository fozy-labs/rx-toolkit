import { MachineConfigError, type MachineClock } from "@fozy-labs/rx-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parallelFixture, squareFixture, trafficLightFixture } from "../testing/fixtures";

import {
    createSourceMachine,
    SourceMachineError,
    type SourceMachine,
    type SourceMachineOptions,
} from "./createSourceMachine";

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

const created: SourceMachine[] = [];

async function create(source: string, options?: SourceMachineOptions): Promise<SourceMachine> {
    const machine = await createSourceMachine(source, options);
    created.push(machine);
    return machine;
}

async function expectFailure(source: string): Promise<SourceMachineError> {
    let caught: unknown;
    try {
        created.push(await createSourceMachine(source));
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(SourceMachineError);
    return caught as SourceMachineError;
}

/** The directive line of the square fixture that the error tests rewrite. */
const SQUARE_GUARD = "%% @guard isFinite: Number.isFinite(event.value)";

describe("createSourceMachine", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        created.splice(0).forEach((machine) => machine.dispose());
        vi.restoreAllMocks();
    });

    it("runs the proposal's square example: payload, guard order, context updates, RESET", async () => {
        expect(squareFixture.source).toContain(SQUARE_GUARD);
        const square$ = await create(squareFixture.source);

        expect(square$.definition.id).toBe("square");
        expect(square$.definition.source).toBe(squareFixture.source);
        expect(square$.status).toBe("running");
        expect(square$()).toMatchObject({ status: "active", value: "idle", context: { result: null, error: null } });

        square$.send({ type: "SQUARE", value: 12 });
        expect(square$()).toMatchObject({ value: "done", context: { result: 144, error: null } });
        expect(square$.matches("done")).toBe(true);
        expect(square$.can({ type: "SQUARE", value: 1 })).toBe(false);

        square$.send({ type: "RESET" });
        expect(square$()).toMatchObject({ value: "idle", context: { result: null, error: null } });

        square$.send({ type: "SQUARE", value: NaN });
        expect(square$()).toMatchObject({ value: "error", context: { result: null, error: "not a finite number" } });
    });

    it("gives every start a fresh context: @context initial is a factory", async () => {
        const square$ = await create(squareFixture.source);
        expect(typeof square$.definition.config.context).toBe("function");

        square$.send({ type: "SQUARE", value: 3 });
        expect(square$().context).toEqual({ result: 9, error: null });

        square$.stop();
        square$.start();
        expect(square$()).toMatchObject({ status: "active", value: "idle", context: { result: null, error: null } });
    });

    it("runs parallel regions, region finals, onDone and a choice state", async () => {
        const parallel$ = await create(parallelFixture.source);

        expect(parallel$().value).toBe("idle");
        parallel$.send({ type: "START" });
        expect(parallel$().value).toEqual({ p: { $0: "a", $1: "c" } });

        for (const type of ["NEXT_A", "FIN_A", "NEXT_C", "FIN_C"]) parallel$.send({ type });
        expect(parallel$().value).toBe("finished");

        // `c1` is a choice: its `always` candidates are picked by guard; `ok` is true.
        parallel$.send({ type: "CHECK" });
        expect(parallel$().value).toBe("idle");

        for (const type of ["START", "NEXT_A", "FIN_A", "NEXT_C", "FIN_C", "FINISH"]) parallel$.send({ type });
        expect(parallel$()).toMatchObject({ status: "done", value: "$final" });
    });

    it("runs the proposal's trafficLight example: timers, the compound final, onDone and RESET / retry", async () => {
        const clock = createManualClock();
        const light$ = await create(trafficLightFixture.source, { clock });

        expect(light$()).toMatchObject({ value: "off", context: { power: true, retries: 0 } });

        light$.send({ type: "POWER_ON" });
        expect(light$().value).toEqual({ working: "green" });
        expect(console.log).toHaveBeenCalledWith("start");

        clock.flush();
        expect(light$().value).toEqual({ working: "yellow" });
        clock.flush();
        expect(light$().value).toEqual({ working: "red" });
        expect(console.warn).toHaveBeenCalledWith("yellow -> red");

        light$.send({ type: "FAULT" });
        expect(light$().value).toBe("broken");

        light$.send({ type: "RESET" });
        expect(light$()).toMatchObject({ value: "off", context: { power: true, retries: 1 } });
    });

    it("reports a body syntax error found by the converter as a parse error with its line", async () => {
        const error = await expectFailure(
            squareFixture.source.replace(SQUARE_GUARD, "%% @guard isFinite: Number.isFinite(event.value"),
        );
        expect(error.stage).toBe("parse");
        expect(error.line).toBe(9);
        expect(error.message).toMatch(/^Parse error, line 9:\d+: syntax error in @guard isFinite: /);
        expect((error.cause as Error).name).toBe("StatechartParseError");
    });

    it("reports a diagram error as a parse error with its line", async () => {
        const error = await expectFailure(
            squareFixture.source.replace("done --> idle: RESET / clear", "done --> idle: RESET / clean"),
        );
        expect(error.stage).toBe("parse");
        expect(error.line).toBe(21);
        expect(error.message).toMatch(/^Parse error, line 21/);
        expect(error.message).toContain("clean");
    });

    it("reports a body that is TypeScript but not JavaScript as a compile error with its line", async () => {
        // The converter checks bodies as TypeScript (they land in a .ts file);
        // the playground evaluates them as JavaScript.
        const error = await expectFailure(
            squareFixture.source.replace(SQUARE_GUARD, "%% @guard isFinite: Number.isFinite(event.value as number)"),
        );
        expect(error.stage).toBe("compile");
        expect(error.line).toBe(9);
        expect(error.message).toMatch(/^Compile error, line 9: @guard isFinite: /);
        expect(error.cause).toBeInstanceOf(Error);
        expect((error.cause as Error).name).toBe("CompileError");
    });

    it("reports a context expression that is not an object as a machine creation failure", async () => {
        const error = await expectFailure(
            squareFixture.source.replace(
                "%% @context initial: { result: null, error: null }",
                "%% @context initial: 5",
            ),
        );
        expect(error.stage).toBe("create");
        expect(error.line).toBeUndefined();
        expect(error.message).toBe(
            "Machine creation failed: @context initial must evaluate to a plain object (got number)",
        );
    });

    it("hands runtime errors of bodies to onError and the snapshot turns to error", async () => {
        const onError = vi.fn();
        const square$ = await create(
            squareFixture.source.replace(SQUARE_GUARD, "%% @guard isFinite: context.missing.deep"),
            { onError },
        );

        square$.send({ type: "SQUARE", value: 12 });

        expect(onError).toHaveBeenCalledTimes(1);
        // The library wraps the body's TypeError with the guard's name and place.
        const reported = onError.mock.calls[0][0] as Error;
        expect(reported).toBeInstanceOf(Error);
        expect(reported.message).toMatch(/^Unable to evaluate guard 'isFinite'/);
        expect(reported.message).toContain("Cannot read properties of undefined");
        expect(square$()).toMatchObject({ status: "error", value: "idle", error: reported });
        expect(square$.status).toBe("stopped");
    });
});

describe("SourceMachineError", () => {
    it("formats the library's MachineConfigError and the converter's gate error", () => {
        const configError = new SourceMachineError("create", new MachineConfigError("states.x", "boom"));
        expect(configError.message).toBe("Machine config error: states.x: boom");
        expect(configError.line).toBeUndefined();

        const gateError = Object.assign(new Error("states.x: boom"), {
            name: "StatechartParseError",
            line: 7,
            path: "x",
            format: () => "7: states.x: boom (at x)",
        });
        const validated = new SourceMachineError("validate", gateError);
        expect(validated.message).toBe("Machine config error, line 7: states.x: boom (at x)");
        expect(validated.line).toBe(7);
    });

    it("labels unknown failures with their stage", () => {
        const error = new SourceMachineError("parse", new RangeError("too deep"));
        expect(error.message).toBe("Parsing failed: too deep");
        expect(error.stage).toBe("parse");
        expect(error.cause).toBeInstanceOf(RangeError);
    });
});
