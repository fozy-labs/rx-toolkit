import { SYMBOL_DISPOSE } from "@/signals/base/disposeSymbol";

import type { MachineDefinition } from "./MachineDefinition";
import { unstable_Statechart as Statechart } from "./Statechart";
import type {
    EventObject,
    MachineContext,
    MachineStateSignal,
    StatechartOptionsOrKey,
    StatechartStatus,
    StateValue,
} from "./types";

/**
 * Public facade, shaped like `Signal.state()` / `LocalSignal.state()`: a
 * callable read-only signal of the snapshot enriched with the machine API,
 * delegating to a `Statechart` engine.
 */
export class unstable_MachineSignal {
    static state<TContext extends MachineContext, TEvent extends EventObject, TOutput = unknown>(
        definition: MachineDefinition<TContext, TEvent, TOutput>,
        options?: StatechartOptionsOrKey,
    ): MachineStateSignal<TContext, TEvent, TOutput> {
        const engine = new Statechart<TContext, TEvent, TOutput>(definition, options);

        function signalFn() {
            return engine.state.get();
        }

        signalFn.peek = () => engine.state.peek();
        signalFn.get = () => engine.state.get();
        signalFn.obs = engine.state.obs;
        signalFn.definition = definition;
        signalFn.send = (event: TEvent) => engine.send(event);
        signalFn.matches = (stateValue: StateValue) => engine.matches(stateValue);
        signalFn.can = (event: TEvent) => engine.can(event);
        signalFn.start = () => engine.start();
        signalFn.stop = () => engine.stop();
        const dispose = () => engine.dispose();
        signalFn.dispose = dispose;
        signalFn[SYMBOL_DISPOSE] = dispose;
        // A live getter (not a snapshot of the value at creation time); expando
        // inference cannot express accessors, hence the explicit property type.
        Object.defineProperty(signalFn, "status", {
            get: (): StatechartStatus => engine.status,
            enumerable: true,
        });

        return signalFn as typeof signalFn & { readonly status: StatechartStatus };
    }
}
