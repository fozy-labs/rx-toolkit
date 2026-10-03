/**
 * `createMachine({...})` source text for Stately Studio "import from code" /
 * `@xstate/machine-extractor`. Spec: section 8.1.
 *
 * The extractor matches the callee name `createMachine`, parses
 * `arguments[0]` as the state-node config and `arguments[1]` as the
 * `{ actions, guards, delays }` table. Actions / guards that are identifiers
 * are accepted by name, builtins are recognised by their call form
 * (`assign(...)`, `raise(...)`, `and([...])`, ...). `satisfies` is never
 * emitted (the extractor cannot parse it).
 */
import { isBuiltin } from "../core/createBuiltin";
import type { MachineDefinition } from "../MachineDefinition";
import type { EventObject, MachineContext } from "../types";
import { BUILTIN } from "../types/brand";

export interface ToXStateSourceOptions {
    /** Name of the exported const. @default the machine id turned into an identifier (`"trafficLight"`); `"machine"` when empty */
    exportName?: string;
    /** Prepend the xstate import line (`createMachine` plus the builtins actually used). @default true */
    includeImport?: boolean;
    /** Render the implementation table as the second argument (functions as identifiers). @default false */
    includeImplementations?: boolean;
    /** Spaces per indentation level. @default 4 */
    indent?: number;
}

/** Builtin creators exported by `xstate`, in the order they appear in the import line. */
const BUILTIN_IMPORTS = ["assign", "raise", "cancel", "log", "and", "or", "not", "stateIn"] as const;

/** Builtins of this package without an XState counterpart; imported from `@fozy-labs/rx-toolkit` on a second line. */
const LIBRARY_IMPORTS = ["mutate"] as const;

const LIBRARY_PACKAGE = "@fozy-labs/rx-toolkit";

type BuiltinName = (typeof BUILTIN_IMPORTS)[number] | (typeof LIBRARY_IMPORTS)[number];

/** Single-line arrays are limited to this many characters (including the brackets). */
const MAX_SINGLE_LINE_ARRAY_LENGTH = 80;

/** Identifier used for functions whose `name` is empty or unusable. */
const ANONYMOUS_IDENTIFIER = "anonymous";

const IDENTIFIER_PATTERN = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u;

/**
 * Words that are valid by the identifier pattern but cannot be used as a
 * binding / bare identifier (ES2015+ strict mode). Quoted keys are fine, so
 * this list only matters for identifiers.
 */
const RESERVED_WORDS = new Set([
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
]);

/**
 * Turns an arbitrary string into a valid JS identifier: non-identifier
 * characters become `_`, a leading digit is prefixed with `_`, reserved words
 * are prefixed with `_`; `fallback` when nothing usable is left.
 */
function toIdentifier(name: string, fallback: string): string {
    // Unicode identifier characters survive: `увеличить` stays `увеличить`.
    let identifier = name.replace(/[^\p{ID_Continue}$\u200C\u200D]/gu, "_");
    // Nothing left, or only underscores produced by sanitizing (`"()"` -> `"__"`): use the fallback.
    if (identifier === "" || (/^_+$/.test(identifier) && identifier !== name)) return fallback;
    if (!/^[\p{ID_Start}$_]/u.test(identifier)) identifier = `_${identifier}`;
    if (RESERVED_WORDS.has(identifier)) identifier = `_${identifier}`;
    return identifier;
}

/** A canonical non-negative integer key (`"3000"`, `"0"`) may stay unquoted, like in the original config. */
function isCanonicalIntegerKey(key: string): boolean {
    return /^(0|[1-9][0-9]*)$/.test(key) && Number.isSafeInteger(Number(key));
}

function renderKey(key: string): string {
    if (IDENTIFIER_PATTERN.test(key) || isCanonicalIntegerKey(key)) return key;
    return JSON.stringify(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

interface RenderState {
    readonly indentUnit: string;
    readonly usedBuiltins: Set<BuiltinName>;
    /** Objects on the current ancestor chain; a revisit means a cycle. */
    readonly ancestors: Set<object>;
    /** Path segments of the position being rendered (`context.items[0]`). */
    path: string;
}

/** Root keys never emitted: `types` is a TypeScript-only inference helper, `source` is the `.mmd` text of this package's converter. */
const DROPPED_ROOT_KEYS = new Set(["types", "source"]);

class SourceRenderer {
    private readonly state: RenderState;

    /** Identifiers emitted for non-builtin function values (`anonymous` included); collected on the dry-run pass. */
    readonly functionIdentifiers = new Set<string>();

    constructor(
        indent: number,
        private readonly aliases?: ReadonlyMap<string, string>,
    ) {
        this.state = { indentUnit: " ".repeat(indent), usedBuiltins: new Set(), ancestors: new Set(), path: "" };
    }

    get usedBuiltins(): ReadonlySet<BuiltinName> {
        return this.state.usedBuiltins;
    }

    /** Renders any value at nesting `depth` (used for the indentation of nested lines). */
    render(value: unknown, depth: number, droppedKeys?: ReadonlySet<string>): string {
        if (value === undefined) return "undefined";
        if (value === null) return "null";
        switch (typeof value) {
            case "string":
                return JSON.stringify(value);
            case "number":
                return Object.is(value, -0) ? "-0" : String(value);
            case "boolean":
                return String(value);
            case "bigint":
                return `${value}n`;
            case "symbol":
                throw new TypeError(`toXStateSource: cannot render a symbol value (${String(value)}).`);
            case "function":
                return isBuiltin(value) ? this.renderBuiltin(value, depth) : this.renderFunction(value);
            default:
                break;
        }
        if (!isRecord(value)) {
            throw new TypeError(`toXStateSource: cannot render a value of type ${typeof value}.`);
        }
        // Every composite kind goes through the ancestor chain: a value already
        // being rendered above this position means a cycle. Shared references
        // that are not ancestors render again (a DAG is fine).
        if (this.state.ancestors.has(value)) {
            throw new TypeError(`toXStateSource: cyclic reference at ${this.state.path || "<root>"}`);
        }
        this.state.ancestors.add(value);
        try {
            if (Array.isArray(value)) return this.renderArray(value, depth);
            if (value instanceof Map) return this.renderMap(value, depth);
            if (value instanceof Set) return this.renderSet(value, depth);
            if (value instanceof Date) return `new Date(${value.getTime()})`;
            if (value instanceof RegExp) return String(value);
            const proto = Object.getPrototypeOf(value);
            if (proto !== Object.prototype && proto !== null) {
                const className = proto.constructor?.name ?? "<anonymous class>";
                throw new TypeError(
                    `toXStateSource: cannot render an instance of ${className} at ${this.state.path || "<root>"}.`,
                );
            }
            return this.renderObject(value, depth, droppedKeys);
        } finally {
            this.state.ancestors.delete(value);
        }
    }

    private indent(depth: number): string {
        return this.state.indentUnit.repeat(depth);
    }

    /** `path.child` for identifier keys, `path["child"]` for the rest; `path` "" means the rendered root. */
    private childPath(key: string): string {
        const path = this.state.path;
        if (IDENTIFIER_PATTERN.test(key)) return path === "" ? key : `${path}.${key}`;
        return `${path}[${JSON.stringify(key)}]`;
    }

    /** Runs `body` with `state.path` temporarily set; restores it on the way out. */
    private atPath(path: string, body: () => string): string {
        const previous = this.state.path;
        this.state.path = path;
        try {
            return body();
        } finally {
            this.state.path = previous;
        }
    }

    private renderFunction(fn: { name: string }): string {
        const identifier = toIdentifier(fn.name, ANONYMOUS_IDENTIFIER);
        this.functionIdentifiers.add(identifier);
        return identifier;
    }

    private renderArray(items: readonly unknown[], depth: number): string {
        if (items.length === 0) return "[]";
        const parent = this.state.path;
        const rendered = items.map((item, index) =>
            this.atPath(`${parent}[${index}]`, () => this.render(item, depth + 1)),
        );
        return this.renderArrayBody(rendered, depth);
    }

    private renderArrayBody(rendered: readonly string[], depth: number): string {
        const singleLine = `[${rendered.join(", ")}]`;
        const fitsOnOneLine =
            rendered.every((item) => !item.includes("\n")) && singleLine.length <= MAX_SINGLE_LINE_ARRAY_LENGTH;
        if (fitsOnOneLine) return singleLine;
        const inner = this.indent(depth + 1);
        return `[\n${rendered.map((item) => `${inner}${item},\n`).join("")}${this.indent(depth)}]`;
    }

    private renderMap(map: Map<unknown, unknown>, depth: number): string {
        if (map.size === 0) return "new Map()";
        const parent = this.state.path;
        const pairs = [...map.entries()].map(([key, value]) =>
            this.atPath(`${parent}.get(${JSON.stringify(String(key))})`, () => {
                return `[${this.render(key, depth + 1)}, ${this.render(value, depth + 1)}]`;
            }),
        );
        return `new Map(${this.renderArrayBody(pairs, depth)})`;
    }

    private renderSet(set: Set<unknown>, depth: number): string {
        if (set.size === 0) return "new Set()";
        const parent = this.state.path;
        const rendered = [...set.values()].map((item, index) =>
            this.atPath(`${parent}[${index}]`, () => this.render(item, depth + 1)),
        );
        return `new Set(${this.renderArrayBody(rendered, depth)})`;
    }

    private renderObject(record: Record<string, unknown>, depth: number, droppedKeys?: ReadonlySet<string>): string {
        const entries = Object.keys(record)
            .filter((key) => !droppedKeys?.has(key) && record[key] !== undefined)
            .map(
                (key) =>
                    `${renderKey(key)}: ${this.atPath(this.childPath(key), () => this.render(record[key], depth + 1))}`,
            );
        if (entries.length === 0) return "{}";
        const inner = this.indent(depth + 1);
        return `{\n${entries.map((entry) => `${inner}${entry},\n`).join("")}${this.indent(depth)}}`;
    }

    /** Renders an options object skipping `undefined` values; `null` when nothing is left (the argument is omitted). */
    private renderOptions(options: Record<string, unknown>, depth: number): string | null {
        const present = Object.keys(options).filter((key) => options[key] !== undefined);
        if (present.length === 0) return null;
        return this.renderObject(options, depth);
    }

    private call(name: BuiltinName, args: readonly string[]): string {
        this.state.usedBuiltins.add(name);
        return `${this.aliases?.get(name) ?? name}(${args.join(", ")})`;
    }

    /** Builtins are frozen functions carrying their payload; they render as the XState creator call. */
    private renderBuiltin(builtin: object, depth: number): string {
        const payload = builtin as Record<string, unknown> & { readonly [BUILTIN]: string };
        switch (payload[BUILTIN]) {
            case "assign":
                return this.call("assign", [this.render(payload.assignment, depth)]);
            case "mutate":
                return this.call("mutate", [this.render(payload.recipe, depth)]);
            case "raise": {
                const options = this.renderOptions({ id: payload.id, delay: payload.delay }, depth);
                const args = [this.render(payload.event, depth)];
                if (options !== null) args.push(options);
                return this.call("raise", args);
            }
            case "cancel":
                return this.call("cancel", [this.render(payload.sendId, depth)]);
            case "log": {
                const args = [this.render(payload.value, depth)];
                if (payload.label !== undefined) args.push(this.render(payload.label, depth));
                return this.call("log", args);
            }
            case "and":
                return this.call("and", [this.render(payload.guards, depth)]);
            case "or":
                return this.call("or", [this.render(payload.guards, depth)]);
            case "not":
                return this.call("not", [this.render(payload.guard, depth)]);
            case "stateIn":
                return this.call("stateIn", [this.render(payload.stateValue, depth)]);
            default:
                throw new TypeError(`toXStateSource: unknown builtin '${String(payload[BUILTIN])}'.`);
        }
    }
}

function resolveExportName(machineId: string | undefined, explicit: string | undefined): string {
    return toIdentifier(explicit ?? machineId ?? "", "machine");
}

/**
 * Renders `definition.config` as a JS object literal: functions become their
 * `name` as an identifier (`anonymous` when nameless), builtin action /
 * guard objects become their XState call form (`assign(...)`, `raise(...)`,
 * `and([...])`, ...; `mutate(...)` imported from this package), `types` and
 * `source` are dropped, `undefined` values are skipped.
 *
 * The output is deterministic: keys keep config order, 4-space indentation by
 * default, trailing commas, short scalar arrays on one line.
 */
export function toXStateSource<TContext extends MachineContext, TEvent extends EventObject, TOutput>(
    definition: MachineDefinition<TContext, TEvent, TOutput>,
    options?: ToXStateSourceOptions,
): string {
    const includeImport = options?.includeImport ?? true;
    const includeImplementations = options?.includeImplementations ?? false;
    const indent = options?.indent ?? 4;
    if (!Number.isInteger(indent) || indent < 0) {
        throw new RangeError(`toXStateSource: 'indent' must be a non-negative integer, got ${String(indent)}.`);
    }

    const render = (aliases?: ReadonlyMap<string, string>): { args: string[]; renderer: SourceRenderer } => {
        const renderer = new SourceRenderer(indent, aliases);
        const args = [renderer.render(definition.config, 0, DROPPED_ROOT_KEYS)];
        if (includeImplementations) {
            const tables: Record<string, unknown> = {};
            for (const table of ["actions", "guards", "delays"] as const) {
                const entries = definition.implementations[table];
                if (Object.keys(entries).length > 0) tables[table] = entries;
            }
            args.push(renderer.render(tables, 0));
        }
        return { args, renderer };
    };

    const exportName = resolveExportName(definition.config.id, options?.exportName);

    // Pass 1 (dry run): which imports will be emitted, and which identifiers
    // user code already claims — function references in the implementation
    // table and the export name. An import name colliding with any of them is
    // aliased (`log as log_`): the user identifier wins, the module must keep
    // pointing at the user's function.
    const dry = render();

    // With no import line emitted the caller supplies the imports under their
    // original names, so no aliases may be applied at all.
    if (!includeImport) {
        return `export const ${exportName} = createMachine(${dry.args.join(", ")});\n`;
    }

    const claimed = new Set<string>([...dry.renderer.functionIdentifiers, exportName]);
    const xstateImports = ["createMachine", ...BUILTIN_IMPORTS.filter((name) => dry.renderer.usedBuiltins.has(name))];
    const libraryImports = LIBRARY_IMPORTS.filter((name) => dry.renderer.usedBuiltins.has(name));
    const aliases = new Map<string, string>();
    for (const name of [...xstateImports, ...libraryImports]) {
        if (!claimed.has(name)) continue;
        let alias = `${name}_`;
        while (claimed.has(alias)) alias = `${alias}_`;
        aliases.set(name, alias);
        claimed.add(alias);
    }

    const { args } = aliases.size > 0 ? render(aliases) : dry;
    const callName = (name: string): string => (aliases.has(name) ? `${name} as ${aliases.get(name)}` : name);
    const declaration = `export const ${exportName} = ${aliases.get("createMachine") ?? "createMachine"}(${args.join(", ")});\n`;

    const lines = [`import { ${xstateImports.map(callName).join(", ")} } from "xstate";`];
    if (libraryImports.length > 0) {
        lines.push(`import { ${libraryImports.map(callName).join(", ")} } from "${LIBRARY_PACKAGE}";`);
    }
    return `${lines.join("\n")}\n\n${declaration}`;
}
