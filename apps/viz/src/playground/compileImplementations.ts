/**
 * Playground compilation of directive bodies ("Contract: ParseResult",
 * playground compilation rules).
 *
 * This module is the ONLY place in apps/viz that evaluates text as code
 * (`new Function`). It backs the `source` mode of `StatechartViz`: a host
 * page using that mode needs CSP `unsafe-eval`, and a foreign `.mmd` file is
 * foreign code. The `machine` mode never reaches this module.
 */

import type { DirectiveBody, ParseResult } from "@fozy-labs/statechart-converter";

export type ImplementationArgs<TContext = unknown, TEvent = unknown> = { context: TContext; event: TEvent };

export type CompiledGuard = (args: ImplementationArgs) => boolean;

export type CompiledDelay = (args: ImplementationArgs) => number;

/** Mutates `args.context` in place (an Immer draft once wrapped by `mutate`). */
export type CompiledActionRecipe = (args: ImplementationArgs) => void;

export type CompiledImplementations = {
    guards: Record<string, CompiledGuard>;
    delays: Record<string, CompiledDelay>;
    actionRecipes: Record<string, CompiledActionRecipe>;
    /** Evaluates `@context initial` — a fresh value on every call. */
    createContext: () => unknown;
};

export type CompileErrorKind = "guard" | "action" | "delay" | "context";

/**
 * A directive body that is not valid JavaScript. `name` stays the standard
 * error name ("CompileError"); the directive name lives in `directiveName`.
 */
export class CompileError extends Error {
    override readonly name = "CompileError";
    readonly kind: CompileErrorKind;
    readonly directiveName: string;
    readonly line: number;
    /** The JavaScript engine's message (`Unexpected token ...`). */
    readonly detail: string;

    constructor(kind: CompileErrorKind, directiveName: string, line: number, cause: unknown) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        super(`@${kind} ${directiveName} (line ${line}): ${detail}`, { cause });
        this.kind = kind;
        this.directiveName = directiveName;
        this.line = line;
        this.detail = detail;
    }
}

type BodyFunction = (context: unknown, event: unknown) => unknown;

function compileBody(kind: CompileErrorKind, name: string, body: DirectiveBody, source: string): BodyFunction {
    try {
        return new Function("context", "event", source) as BodyFunction;
    } catch (error) {
        throw new CompileError(kind, name, body.line, error);
    }
}

function compileExpression(kind: "guard" | "delay", name: string, body: DirectiveBody): BodyFunction {
    return compileBody(kind, name, body, "return (" + body.text + ")");
}

function compileStatements(name: string, body: DirectiveBody): BodyFunction {
    return compileBody("action", name, body, body.text);
}

function compileContextFactory(body: DirectiveBody | undefined): () => unknown {
    if (body === undefined) {
        return () => ({});
    }
    try {
        return new Function("return (" + body.text + ")") as () => unknown;
    } catch (error) {
        throw new CompileError("context", "initial", body.line, error);
    }
}

/**
 * Compiles every directive body eagerly so that syntax errors surface here,
 * not on first use. Runtime errors thrown by a body while the machine runs are
 * not caught — they belong to the machine's error handling.
 */
export function compileImplementations(parsed: ParseResult): CompiledImplementations {
    const guards: Record<string, CompiledGuard> = {};
    for (const [name, body] of Object.entries(parsed.guards)) {
        const fn = compileExpression("guard", name, body);
        guards[name] = ({ context, event }) => Boolean(fn(context, event));
    }

    const delays: Record<string, CompiledDelay> = {};
    for (const [name, body] of Object.entries(parsed.delays)) {
        const fn = compileExpression("delay", name, body);
        delays[name] = ({ context, event }) => fn(context, event) as number;
    }

    const actionRecipes: Record<string, CompiledActionRecipe> = {};
    for (const [name, body] of Object.entries(parsed.actions)) {
        const fn = compileStatements(name, body);
        actionRecipes[name] = ({ context, event }) => {
            fn(context, event);
        };
    }

    return {
        guards,
        delays,
        actionRecipes,
        createContext: compileContextFactory(parsed.context.initial),
    };
}

/** The shape of the library's `mutate` builtin; structural so that this module stays free of the library import. */
export type MutateLike<TAction = unknown> = (recipe: (args: ImplementationArgs) => void) => TAction;

export type MachineImplementationsLike<TAction> = {
    guards: Record<string, CompiledGuard>;
    actions: Record<string, TAction>;
    delays: Record<string, CompiledDelay>;
};

/** Wraps every action recipe with `mutate`, producing the implementations table of `createMachine`. */
export function toMachineImplementations<TAction>(
    compiled: CompiledImplementations,
    mutate: MutateLike<TAction>,
): MachineImplementationsLike<TAction> {
    const actions: Record<string, TAction> = {};
    for (const [name, recipe] of Object.entries(compiled.actionRecipes)) {
        actions[name] = mutate(recipe);
    }
    return { guards: compiled.guards, actions, delays: compiled.delays };
}
