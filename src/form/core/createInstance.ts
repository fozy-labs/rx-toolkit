import { isDefinition } from "./definition/records";
import { FormConfigError } from "./FormConfigError";
import { GroupCore } from "./nodes/GroupCore";
import { ABSENT, isProvided } from "./runtime/values";

/**
 * `FormSignal.state(definition, init)`: builds the node tree from the defaults and the starting
 * `state`, without subscriptions, timers or requests. Nothing outside holds the instance.
 */
export function createInstance(definition: unknown, init: unknown): object {
    if (!isDefinition(definition) || definition.kind !== "group") {
        throw new FormConfigError("", "FormSignal.state() expects a group definition as the root");
    }
    const options = (init ?? {}) as { state?: unknown; context?: unknown; key?: unknown };
    const key = typeof options.key === "string" ? options.key : (definition.name ?? "root");
    const initial = isProvided(options, "state") ? options.state : ABSENT;
    return new GroupCore(definition, null, null, initial, { key, context: options.context }).node;
}
