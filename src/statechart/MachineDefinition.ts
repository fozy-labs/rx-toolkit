import { isBuiltin } from "./core/createBuiltin";
import { MachineConfigError } from "./core/MachineConfigError";
import type { MachineModel } from "./core/model";
import { createReferenceCollector, validateAction, validateGuard } from "./core/normalize";
import { describeValue, isPlainObject } from "./core/utils";
import { toMermaid, type ToMermaidOptions } from "./export/toMermaid";
import { toXStateSource, type ToXStateSourceOptions } from "./export/toXStateSource";
import type {
    EventObject,
    MachineConfig,
    MachineContext,
    MachineImplementations,
    ResolvedMachineImplementations,
} from "./types";
import type { DeepReadonly } from "./types/common";

const IMPLEMENTATION_TABLES = ["actions", "guards", "delays"] as const;

type ImplementationTable = (typeof IMPLEMENTATION_TABLES)[number];

const IMPLEMENTATION_KEYS: ReadonlySet<string> = new Set(IMPLEMENTATION_TABLES);

/**
 * Definitions whose lazy implementation check already passed. Definitions
 * are immutable, so the check is pure repeated work per instance (per
 * component mount in React); failures are not cached so the same
 * `MachineConfigError` is thrown again on the next attempt.
 */
const checkedDefinitions = new WeakSet<object>();

function tablePath(table: ImplementationTable): string {
    return `implementations.${table}`;
}

/**
 * Shape validation of an implementation table (names are matched against the
 * config lazily, see `assertImplementations`). Rejects unknown top-level keys
 * (`actors`, `services`, `devTools`, ...) and values that could never run.
 */
function validateImplementations<TContext extends MachineContext, TEvent extends EventObject>(
    implementations: unknown,
): MachineImplementations<TContext, TEvent> {
    if (implementations === undefined) return {};
    if (!isPlainObject(implementations)) {
        throw new MachineConfigError(
            "implementations",
            `implementations must be a plain object (got ${describeValue(implementations)})`,
        );
    }
    for (const key of Object.keys(implementations)) {
        if (!IMPLEMENTATION_KEYS.has(key)) {
            throw new MachineConfigError(
                "implementations",
                `'${key}' is not supported (allowed: actions, guards, delays)`,
            );
        }
    }
    for (const table of IMPLEMENTATION_TABLES) {
        const value = implementations[table];
        if (value !== undefined && !isPlainObject(value)) {
            throw new MachineConfigError(tablePath(table), `must be a plain object (got ${describeValue(value)})`);
        }
    }
    const references = createReferenceCollector();
    const actions = implementations.actions ?? {};
    for (const [name, value] of Object.entries(actions)) {
        if (typeof value !== "function") {
            throw new MachineConfigError(
                tablePath("actions"),
                `action '${name}' must be a function or a builtin action (got ${describeValue(value)})`,
            );
        }
        validateAction(value, `${tablePath("actions")}.${name}`, references);
    }
    const guards = implementations.guards ?? {};
    for (const [name, value] of Object.entries(guards)) {
        if (typeof value !== "function") {
            throw new MachineConfigError(
                tablePath("guards"),
                `guard '${name}' must be a function or a builtin guard (got ${describeValue(value)})`,
            );
        }
        validateGuard(null, value, `${tablePath("guards")}.${name}`, references);
    }
    const delays = implementations.delays ?? {};
    for (const [name, value] of Object.entries(delays)) {
        const isValidNumber = typeof value === "number" && Number.isFinite(value) && value >= 0;
        if (!isValidNumber && typeof value !== "function") {
            throw new MachineConfigError(
                tablePath("delays"),
                `delay '${name}' must be a non-negative finite number or a function (got ${
                    typeof value === "number" ? String(value) : describeValue(value)
                })`,
            );
        }
    }
    return implementations as MachineImplementations<TContext, TEvent>;
}

function resolveImplementations<TContext extends MachineContext, TEvent extends EventObject>(
    implementations: MachineImplementations<TContext, TEvent> | undefined,
): ResolvedMachineImplementations<TContext, TEvent> {
    const validated = validateImplementations<TContext, TEvent>(implementations);
    return Object.freeze({
        actions: Object.freeze({ ...validated.actions }),
        guards: Object.freeze({ ...validated.guards }),
        delays: Object.freeze({ ...validated.delays }),
    });
}

/**
 * Module-private access to the private constructor and the private `model`
 * field, captured by the class's static block. Keeps both out of the public
 * declaration file without relying on `stripInternal`.
 */
interface MachineDefinitionInternals {
    create<TContext extends MachineContext, TEvent extends EventObject, TOutput>(
        config: FrozenMachineConfig<TContext, TEvent, TOutput>,
        implementations: MachineImplementations<TContext, TEvent> | undefined,
        model: MachineModel<TContext, TEvent>,
    ): MachineDefinition<TContext, TEvent, TOutput>;
    model<TContext extends MachineContext, TEvent extends EventObject, TOutput>(
        definition: MachineDefinition<TContext, TEvent, TOutput>,
    ): MachineModel<TContext, TEvent>;
}

let internals: MachineDefinitionInternals | undefined;

/** The config as `MachineDefinition` exposes it: the same object, typed as deep-frozen. */
type FrozenMachineConfig<TContext extends MachineContext, TEvent extends EventObject, TOutput> = DeepReadonly<
    MachineConfig<TContext, TEvent, TOutput>
>;

/**
 * The blueprint returned by `createMachine()`: validated config, implementation
 * table and (privately) the normalized model. Stateless; one definition drives
 * any number of `Statechart` instances. Constructed only through `createMachine`.
 */
export class MachineDefinition<
    TContext extends MachineContext = MachineContext,
    TEvent extends EventObject = EventObject,
    TOutput = unknown,
> {
    /**
     * The raw config as passed to `createMachine` — the very same object,
     * deep-frozen (the initial `context` object excepted), which the type
     * reflects: plain objects and arrays are read-only all the way down.
     */
    readonly config: FrozenMachineConfig<TContext, TEvent, TOutput>;
    readonly implementations: ResolvedMachineImplementations<TContext, TEvent>;
    /** Normalized model; read through `getMachineModel()` inside the package only. */
    private readonly model: MachineModel<TContext, TEvent>;

    private constructor(
        config: FrozenMachineConfig<TContext, TEvent, TOutput>,
        implementations: ResolvedMachineImplementations<TContext, TEvent>,
        model: MachineModel<TContext, TEvent>,
    ) {
        this.config = config;
        this.implementations = implementations;
        this.model = model;
    }

    static {
        internals = {
            create: (config, implementations, model) =>
                new MachineDefinition(config, resolveImplementations(implementations), model),
            model: (definition) => definition.model,
        };
    }

    /** Machine id: `config.id` or `"(machine)"`. */
    get id(): string {
        return this.model.id;
    }

    /**
     * `config.source`: the verbatim `.mmd` text the machine was generated
     * from (the viz renders it instead of `toMermaid()`); `undefined` for
     * config-authored machines. Carried over by `provide()`.
     */
    get source(): string | undefined {
        return this.config.source;
    }

    /**
     * Returns a new definition with the given implementations merged over the
     * existing ones (new wins). Shapes are validated immediately; names are
     * matched against the config by `new Statechart()`.
     */
    provide(implementations: MachineImplementations<TContext, TEvent>): MachineDefinition<TContext, TEvent, TOutput> {
        const validated = validateImplementations<TContext, TEvent>(implementations);
        return new MachineDefinition<TContext, TEvent, TOutput>(
            this.config,
            resolveImplementations({
                actions: { ...this.implementations.actions, ...validated.actions },
                guards: { ...this.implementations.guards, ...validated.guards },
                delays: { ...this.implementations.delays, ...validated.delays },
            }),
            this.model,
        );
    }

    /** `createMachine({...})` source text for Stately Studio "import from code". */
    toXStateSource(options?: ToXStateSourceOptions): string {
        return toXStateSource(this, options);
    }

    /** Mermaid `stateDiagram-v2` of the machine. */
    toMermaid(options?: ToMermaidOptions): string {
        return toMermaid(this, options);
    }
}

/**
 * Package-internal factory used by `createMachine` (not exported from the
 * barrel). `createMachine` deep-freezes `config` right after this call, which
 * is what the read-only view the definition exposes stands for: the same
 * object, never a copy.
 */
export function createMachineDefinition<TContext extends MachineContext, TEvent extends EventObject, TOutput>(
    config: MachineConfig<TContext, TEvent, TOutput>,
    implementations: MachineImplementations<TContext, TEvent> | undefined,
    model: MachineModel<TContext, TEvent>,
): MachineDefinition<TContext, TEvent, TOutput> {
    // `MachineConfig` of unresolved type parameters is a deferred conditional
    // type, so TS cannot relate it to its `DeepReadonly` view structurally.
    const frozenView = config as unknown as FrozenMachineConfig<TContext, TEvent, TOutput>;
    return internals!.create(frozenView, implementations, model);
}

/** Package-internal accessor of the normalized model (engine, exporters, tests); not exported from the barrel. */
export function getMachineModel<TContext extends MachineContext, TEvent extends EventObject, TOutput>(
    definition: MachineDefinition<TContext, TEvent, TOutput>,
): MachineModel<TContext, TEvent> {
    return internals!.model(definition);
}

function assertNamesImplemented(
    names: Iterable<string>,
    table: Readonly<Record<string, unknown>>,
    tableName: ImplementationTable,
    kind: "action" | "guard" | "delay",
): void {
    for (const name of names) {
        if (!Object.hasOwn(table, name)) {
            throw new MachineConfigError(tablePath(tableName), `${kind} '${name}' is not implemented`);
        }
    }
}

/**
 * Lazy implementation check (spec 6.3), run by `new Statechart()` so that
 * `definition.provide()` can fill the tables after `createMachine()`:
 *
 * 1. every action / guard / delay name referenced by the config must exist in
 *    the corresponding table (order: actions, guards, delays; first missing
 *    name throws);
 * 2. builtins stored in the tables must resolve too — `raise(..., { delay:
 *    "<name>" })` needs the delay, `and` / `or` / `not` need their string
 *    members, `stateIn("#id")` needs the node — and named guards must not
 *    reference each other in a cycle.
 *
 * Throws `MachineConfigError("implementations.<table>", ...)`. A definition
 * that passed once is remembered (`WeakSet`) and not re-scanned.
 */
export function assertImplementations<TContext extends MachineContext, TEvent extends EventObject, TOutput>(
    definition: MachineDefinition<TContext, TEvent, TOutput>,
): void {
    if (checkedDefinitions.has(definition)) return;

    const model = getMachineModel(definition);
    const { actions, guards, delays } = definition.implementations;

    assertNamesImplemented(model.references.actions, actions, "actions", "action");
    assertNamesImplemented(model.references.guards, guards, "guards", "guard");
    assertNamesImplemented(model.references.delays, delays, "delays", "delay");

    const tableReferences = createReferenceCollector();
    const guardDependencies = new Map<string, ReadonlySet<string>>();
    for (const [name, value] of Object.entries(actions)) {
        if (isBuiltin(value)) validateAction(value, `${tablePath("actions")}.${name}`, tableReferences);
    }
    for (const [name, value] of Object.entries(guards)) {
        if (!isBuiltin(value)) continue;
        const own = createReferenceCollector();
        validateGuard(model, value, `${tablePath("guards")}.${name}`, own);
        guardDependencies.set(name, own.guards);
        for (const referenced of own.guards) tableReferences.guards.add(referenced);
    }
    assertNamesImplemented(tableReferences.guards, guards, "guards", "guard");
    assertNamesImplemented(tableReferences.delays, delays, "delays", "delay");
    assertNoGuardCycle(guardDependencies);

    checkedDefinitions.add(definition);
}

/** A builtin guard implementation referencing itself (directly or through other named guards) would recurse forever. */
function assertNoGuardCycle(dependencies: ReadonlyMap<string, ReadonlySet<string>>): void {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string, trail: readonly string[]): void => {
        if (done.has(name)) return;
        if (visiting.has(name)) {
            throw new MachineConfigError(
                tablePath("guards"),
                `guard '${name}' references itself through ${[...trail, name].map((n) => `'${n}'`).join(" -> ")}`,
            );
        }
        visiting.add(name);
        for (const next of dependencies.get(name) ?? []) visit(next, [...trail, name]);
        visiting.delete(name);
        done.add(name);
    };
    for (const name of dependencies.keys()) visit(name, []);
}
