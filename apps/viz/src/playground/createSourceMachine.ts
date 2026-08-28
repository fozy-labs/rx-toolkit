import {
    createMachine,
    MachineSignal,
    mutate,
    type AnyEventObject,
    type MachineClock,
    type MachineConfig,
    type MachineContext,
    type MachineStateSignal,
} from "@fozy-labs/rx-toolkit";
import type { ParseResult, StatechartParseError } from "@fozy-labs/statechart-converter";

import { CompileError, compileImplementations, toMachineImplementations } from "./compileImplementations";

/** The machine `source` mode runs: the library's signal over an untyped context and event union. */
export type SourceMachine = MachineStateSignal<MachineContext, AnyEventObject>;

/** Stage of the pipeline that failed: `parse` → `validate` → `compile` → `create`. */
export type SourceStage = "parse" | "validate" | "compile" | "create";

export type SourceMachineOptions = {
    /** Timer source of `after` transitions; defaults to the global timers. */
    clock?: MachineClock;
    /**
     * Receives errors a body throws while the machine runs (the snapshot turns
     * to `status: "error"`). Without it the library rethrows them from
     * `send()` / `start()`, and from `createSourceMachine` when the initial
     * step fails.
     */
    onError?: (error: unknown) => void;
    /** Redux DevTools key of the machine signal. */
    key?: string;
};

type Converter = typeof import("@fozy-labs/statechart-converter");

let converterModule: Promise<Converter> | undefined;

/**
 * Loads the converter — and with it the TypeScript compiler API it depends
 * on — on first use, exactly like `mermaid` in `core/mermaidGraph`: `machine`
 * mode never calls this, so a host bundling the viz for that mode never
 * pays for the parser.
 */
function loadConverter(): Promise<Converter> {
    converterModule ??= import("@fozy-labs/statechart-converter");
    return converterModule;
}

const STAGE_LABELS: Record<SourceStage, string> = {
    parse: "Parsing",
    validate: "Validation",
    compile: "Compilation",
    create: "Machine creation",
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Structural check: the class is not imported (that would load the converter
 * eagerly), and a second copy of the package would fail `instanceof` anyway.
 */
function isStatechartParseError(error: unknown): error is StatechartParseError {
    return (
        error instanceof Error &&
        error.name === "StatechartParseError" &&
        typeof (error as Partial<StatechartParseError>).line === "number" &&
        typeof (error as Partial<StatechartParseError>).format === "function"
    );
}

/** The library's `MachineConfigError`, by name: the library may be a second copy in the host. */
function isMachineConfigError(error: unknown): error is Error & { name: "MachineConfigError" } {
    return error instanceof Error && error.name === "MachineConfigError";
}

function describeFailure(stage: SourceStage, cause: unknown): string {
    if (isStatechartParseError(cause)) {
        const label = stage === "validate" ? "Machine config error" : "Parse error";
        return `${label}, line ${cause.format()}`;
    }
    if (cause instanceof CompileError) {
        return `Compile error, line ${cause.line}: @${cause.kind} ${cause.directiveName}: ${cause.detail}`;
    }
    if (isMachineConfigError(cause)) return `Machine config error: ${cause.message}`;
    return `${STAGE_LABELS[stage]} failed: ${messageOf(cause)}`;
}

function lineOf(cause: unknown): number | undefined {
    if (isStatechartParseError(cause)) return cause.line;
    if (cause instanceof CompileError) return cause.line;
    return undefined;
}

/**
 * A failed pipeline stage. `message` is the notice text: `Parse error, line
 * N[:col]: … [(at path)]`, `Machine config error, line N: …` (the converter's
 * `createMachine` gate), `Compile error, line N: @kind name: …`,
 * `Machine config error: …` (the library's `MachineConfigError`), or
 * `<Stage> failed: …` for anything else. The original error is `cause`.
 */
export class SourceMachineError extends Error {
    override readonly name = "SourceMachineError";
    readonly stage: SourceStage;
    /** 1-based source line, when the failing stage knows one. */
    readonly line: number | undefined;

    constructor(stage: SourceStage, cause: unknown) {
        super(describeFailure(stage, cause), { cause });
        this.stage = stage;
        this.line = lineOf(cause);
    }
}

function runStage<T>(stage: SourceStage, step: () => T): T {
    try {
        return step();
    } catch (error) {
        throw new SourceMachineError(stage, error);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * The library config of a parse result. The context is a factory so that
 * every instance and every restart evaluates `@context initial` afresh —
 * a shared initial object would leak mutations between them.
 */
function toMachineConfig(
    parsed: ParseResult,
    createContext: () => unknown,
): MachineConfig<MachineContext, AnyEventObject> {
    const { id, source, initial, states } = parsed.config;
    return {
        id,
        source,
        initial,
        // `StateNodeJson` admits bare target strings inside `after` / `onDone`
        // candidate arrays where `MachineConfig` spells out objects; the two
        // types cannot be related statically. `validateMachineConfig` has
        // already run `createMachine` over this very config.
        states: states as MachineConfig<MachineContext, AnyEventObject>["states"],
        context: () => {
            const context = createContext();
            if (!isPlainObject(context)) {
                throw new TypeError(`@context initial must evaluate to a plain object (got ${typeof context})`);
            }
            return context;
        },
    };
}

/**
 * Playground pipeline: `.mmd` text → running machine.
 * `parse(source)` → `validateMachineConfig(parsed)` → `compileImplementations(parsed)`
 * → `toMachineImplementations(compiled, mutate)` → `createMachine(config, implementations)`
 * → `MachineSignal.state(definition)`. Rejects with `SourceMachineError`; the
 * caller owns the returned machine and must `dispose()` it.
 */
export async function createSourceMachine(source: string, options: SourceMachineOptions = {}): Promise<SourceMachine> {
    const converter = await loadConverter();
    const parsed = runStage("parse", () => converter.parse(source));
    runStage("validate", () => converter.validateMachineConfig(parsed));
    const compiled = runStage("compile", () => compileImplementations(parsed));
    const implementations = toMachineImplementations(compiled, mutate);
    return runStage("create", () => {
        // Explicit type arguments: inference would take `TEvent` from the
        // `mutate` builtins of the implementation table (plain `EventObject`).
        const definition = createMachine<MachineContext, AnyEventObject>(
            toMachineConfig(parsed, compiled.createContext),
            implementations,
        );
        return MachineSignal.state(definition, { clock: options.clock, onError: options.onError, key: options.key });
    });
}
