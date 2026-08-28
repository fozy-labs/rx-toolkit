import { deepFreeze } from "./core/deepFreeze";
import { normalize } from "./core/normalize";
import { createMachineDefinition, type MachineDefinition } from "./MachineDefinition";
import type { AnyEventObject, EventObject, MachineConfig, MachineContext, MachineImplementations } from "./types";

/**
 * Creates a machine definition from an XState v5 config.
 *
 * The name `createMachine` is a functional requirement: Stately's extractor
 * matches call expressions by callee name only. Keep the config inline or in a
 * variable of the same file, never behind `satisfies`.
 *
 * Validates strictly (throws `MachineConfigError`) and only then deep-freezes
 * `config` in place — except the initial `context` object, which stays mutable
 * and is shared by every instance exactly like in XState (`assign` never
 * mutates it; use a `context` factory for per-instance objects). A rejected
 * config is left untouched, so it can be fixed in place and retried. Unknown
 * action/guard/delay *names* are checked later, by `new Statechart()`, so that
 * `definition.provide()` can supply them.
 */
export function createMachine<
    TContext extends MachineContext,
    TEvent extends EventObject = AnyEventObject,
    TOutput = unknown,
>(
    config: MachineConfig<TContext, TEvent, TOutput>,
    implementations?: MachineImplementations<TContext, TEvent>,
): MachineDefinition<TContext, TEvent, TOutput> {
    // Config first, then the implementation tables; the freeze comes last so
    // that nothing of the caller's is frozen when either validation throws.
    const model = normalize(config);
    const definition = createMachineDefinition(config, implementations, model);
    deepFreeze(config, { except: ["context"] });
    return definition;
}
