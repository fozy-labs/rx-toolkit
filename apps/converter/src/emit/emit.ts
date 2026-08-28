/**
 * `ParseResult` → generated TypeScript file (Contract: generated file).
 * Bodies are emitted verbatim (re-indented only) in the same wrapping the
 * syntax check used; the config is printed from the JSON subset.
 */
import { StatechartParseError } from "../StatechartParseError.js";
import { type DirectiveBody, type EmitOptions, type ParseResult, type SystemTriggerMarker } from "../types.js";

import { analyzeBodyUsage, type BodyUsage } from "./bodyUsage.js";
import { INDENT, printValue, type JsonValue } from "./printConfig.js";

const DEFAULT_IMPORT_FROM = "@fozy-labs/rx-toolkit";
const I1 = INDENT;
const I2 = INDENT.repeat(2);
const I3 = INDENT.repeat(3);

/** Prefixes every line but the first with `indent` (continuation lines of an inline value). */
function reindent(text: string, indent: string): string {
    return text
        .split("\n")
        .map((line, index) => (index === 0 || line === "" ? line : indent + line))
        .join("\n");
}

/** Prefixes every non-empty line with `indent` (a block body on its own lines). */
function indentAll(text: string, indent: string): string {
    return text
        .split("\n")
        .map((line) => (line === "" ? line : indent + line))
        .join("\n");
}

function escapeTemplateLiteral(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function baseName(fileName: string): string {
    return fileName.split(/[\\/]/).pop() ?? fileName;
}

/** 1-based line of `%% @<kind> <head>` in the verbatim source (`ParseResult` keeps no line for `context.type`); 1 when absent. */
function findDirectiveLine(source: string, kind: string, head: string): number {
    const pattern = new RegExp(`^\\s*%%\\s*@${kind}[ \\t]+${head}(?![^\\s:])`);
    const index = source.split(/\r\n|\r|\n/).findIndex((line) => pattern.test(line));
    return index === -1 ? 1 : index + 1;
}

class Imports {
    mutate = false;
    actionArgs = false;
    guardArgs = false;
    machineEvent = false;

    render(importFrom: string): string {
        const names = ["createMachine"];
        if (this.mutate) names.push("mutate");
        if (this.actionArgs) names.push("type ActionArgs");
        if (this.guardArgs) names.push("type GuardArgs");
        if (this.machineEvent) names.push("type MachineEvent");
        return `import { ${names.join(", ")} } from ${JSON.stringify(importFrom)};`;
    }
}

class Emitter {
    private readonly imports = new Imports();

    constructor(
        private readonly parsed: ParseResult,
        private readonly options: EmitOptions,
    ) {}

    emit(): string {
        const { parsed } = this;
        const contextType = this.contextType();
        const contextInitial = this.contextInitial();
        const implementations = this.implementations();

        const definitionArgs = [this.configLiteral(contextInitial)];
        if (implementations !== null) definitionArgs.push(implementations);

        const sections = [
            this.header(),
            this.imports.render(this.options.importFrom ?? DEFAULT_IMPORT_FROM),
            "",
            `export type Context = ${contextType};`,
            "",
            this.eventsDeclaration(),
            "",
            `export type StateId = ${parsed.states.map((state) => JSON.stringify(state.path)).join(" | ")};`,
            "",
            `export const source = \`${escapeTemplateLiteral(parsed.config.source)}\`;`,
            "",
            "export const definition = createMachine<Context, Events>(",
            ...definitionArgs.map((argument) => `${I1}${argument},`),
            ");",
        ];
        return `${sections.join("\n")}\n`;
    }

    private header(): string {
        const { fileName } = this.options;
        return fileName === undefined
            ? "// AUTO-GENERATED — do not edit"
            : `// AUTO-GENERATED from ${baseName(fileName)} — do not edit`;
    }

    // --- types ---------------------------------------------------------------

    private contextType(): string {
        const { type, initial } = this.parsed.context;
        if (type === undefined && initial !== undefined) {
            throw new StatechartParseError(
                "`@context initial` requires `@context type`: the generated file must be typed",
                {
                    line: initial.line,
                },
            );
        }
        if (type !== undefined && initial === undefined) {
            throw new StatechartParseError("`@context type` requires `@context initial`", {
                line: findDirectiveLine(this.parsed.config.source, "context", "type"),
            });
        }
        return type ?? "{}";
    }

    private contextInitial(): string {
        const { initial } = this.parsed.context;
        return initial === undefined ? "{}" : initial.text;
    }

    /** `Events = never` without events; otherwise one `| { type: "X" }` member per line (`& payload` when declared). */
    private eventsDeclaration(): string {
        const { eventTypes, events } = this.parsed;
        if (eventTypes.length === 0) return "export type Events = never;";
        const members = eventTypes.map((name) => {
            const payload = events[name];
            const base = `{ type: ${JSON.stringify(name)} }`;
            return payload === undefined ? base : `(${base} & ${reindent(payload, I1)})`;
        });
        return `export type Events =\n${members.map((member) => `${I1}| ${member}`).join("\n")};`;
    }

    private eventTypeFor(references: Array<string | SystemTriggerMarker> | undefined): string {
        if (references === undefined || references.length === 0 || references.some((name) => name.startsWith("$"))) {
            this.imports.machineEvent = true;
            return "MachineEvent<Events>";
        }
        return `Extract<Events, { type: ${references.map((name) => JSON.stringify(name)).join(" | ")} }>`;
    }

    // --- config --------------------------------------------------------------

    private configLiteral(contextInitial: string): string {
        const { config } = this.parsed;
        const lines = [
            "{",
            `${I2}id: ${JSON.stringify(config.id)},`,
            `${I2}source,`,
            `${I2}context: ${reindent(contextInitial, I2)},`,
            `${I2}initial: ${JSON.stringify(config.initial)},`,
            `${I2}states: ${printValue(config.states as JsonValue, I2)},`,
            `${I1}}`,
        ];
        return lines.join("\n");
    }

    // --- implementations -----------------------------------------------------

    private implementations(): string | null {
        const { guards, actions, delays } = this.parsed;
        const tables: string[] = [];
        const guardEntries = Object.entries(guards).map(([name, body]) => this.guardEntry(name, body));
        if (guardEntries.length > 0) tables.push(this.table("guards", guardEntries));
        const actionEntries = Object.entries(actions).map(([name, body]) => this.actionEntry(name, body));
        if (actionEntries.length > 0) tables.push(this.table("actions", actionEntries));
        const delayEntries = Object.entries(delays).map(([name, body]) => this.delayEntry(name, body));
        if (delayEntries.length > 0) tables.push(this.table("delays", delayEntries));
        if (tables.length === 0) return null;
        return `{\n${tables.join("\n")}\n${I1}}`;
    }

    private table(name: string, entries: string[]): string {
        return `${I2}${name}: {\n${entries.join("\n")}\n${I2}},`;
    }

    /** `({ context, event }: Args<Context, E>)` over the arguments the body reads; `()` when it reads none. */
    private parameters(
        usage: BodyUsage,
        argsType: "GuardArgs" | "ActionArgs",
        references: Array<string | SystemTriggerMarker> | undefined,
    ): string {
        const names = [usage.context ? "context" : null, usage.event ? "event" : null].filter(
            (name): name is string => name !== null,
        );
        if (names.length === 0) return "()";
        if (argsType === "GuardArgs") this.imports.guardArgs = true;
        else this.imports.actionArgs = true;
        return `({ ${names.join(", ")} }: ${argsType}<Context, ${this.eventTypeFor(references)}>)`;
    }

    private expression(text: string): string {
        if (!text.includes("\n")) return `(${text})`;
        return `(\n${indentAll(text, I3 + I1)}\n${I3})`;
    }

    private block(text: string): string {
        return `{\n${indentAll(text, I3 + I1)}\n${I3}}`;
    }

    private guardEntry(name: string, body: DirectiveBody): string {
        const usage = analyzeBodyUsage(body.text, "expression");
        const parameters = this.parameters(usage, "GuardArgs", this.parsed.references.guards[name]);
        return `${I3}${name}: ${parameters} => ${this.expression(body.text)},`;
    }

    /** Actions that read `context` get the Immer `mutate` wrapper (the proposal's example); the others are plain functions. */
    private actionEntry(name: string, body: DirectiveBody): string {
        const usage = analyzeBodyUsage(body.text, "statements");
        const parameters = this.parameters(usage, "ActionArgs", this.parsed.references.actions[name]);
        const fn = `${parameters} => ${this.block(body.text)}`;
        if (!usage.context) return `${I3}${name}: ${fn},`;
        this.imports.mutate = true;
        return `${I3}${name}: mutate(${fn}),`;
    }

    /** Delays run on entry of the state; the entering event is unknown, hence `MachineEvent<Events>`. */
    private delayEntry(name: string, body: DirectiveBody): string {
        const usage = analyzeBodyUsage(body.text, "expression");
        const parameters = this.parameters(usage, "ActionArgs", undefined);
        return `${I3}${name}: ${parameters} => ${this.expression(body.text)},`;
    }
}

/** Renders the generated file for `parsed`. Throws `StatechartParseError` when `@context type` / `initial` are not both present or both absent. */
export function emit(parsed: ParseResult, options: EmitOptions = {}): string {
    return new Emitter(parsed, options).emit();
}
