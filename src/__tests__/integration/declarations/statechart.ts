// A consumer of the statechart module: every export is left to inference, so its
// declaration names the definition's config and the machine snapshots.
// `declarations.test.ts` compiles it against the built package, with `@/index`
// replaced by the package name.
import {
    assign,
    unstable_createMachine as createMachine,
    unstable_MachineSignal as MachineSignal,
    type MachineSnapshot,
} from "@/index";

export const light = createMachine({
    id: "light",
    initial: "green",
    context: { cycles: 0 },
    states: { green: { after: { 1000: "red" } }, red: { on: { TICK: "green" } } },
});

// The config of a definition: its type is the deep-readonly view of the machine
// config, whose inference machinery must be inlinable — otherwise the emit needs a
// non-portable reference into the package (TS2742).
export const cfg = light.config;

export const light$ = MachineSignal.state(light, { autoStart: false });
export const snap = light$();

export function active(state: MachineSnapshot<{ cycles: number }>) {
    return state.status === "active" ? state : null;
}

export const setCycles = assign(({ context }) => ({ cycles: context.cycles + 1 }));
