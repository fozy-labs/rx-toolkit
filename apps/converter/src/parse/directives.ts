/**
 * `%% @…` directives. Grammar (proposal, section «Директивы»):
 *
 * ```
 * directive := "%%" SP* "@" KIND (SP+ HEAD)? (":" SP* INLINE)?
 * continue  := "%%" SP+ LINE          -- continuation of the nearest directive above
 * KIND      := machine | context | event | guard | action | delay
 * ```
 *
 * A body is the inline text after `:` plus the following continuation lines;
 * it ends at the next `%% @` line or at any line that is not a `%%` line. A
 * bare `%%` inside a body is an empty body line; `%%text` (no space) is a
 * plain comment and ends the body. The common indent of the continuation
 * lines is removed. Directives may stand anywhere: before the header, at the
 * root, inside `state X { }` — mermaid ignores every `%%` line.
 */
import { StatechartParseError } from "../StatechartParseError.js";

import { isDirectiveLine, isInitDirectiveLine, type SourceLine } from "./lines.js";
import { isName, NAME_HINT, RESERVED_TRIGGERS } from "./names.js";

export type DirectiveKind = "machine" | "context" | "event" | "guard" | "action" | "delay";

const DIRECTIVE_KINDS: ReadonlySet<string> = new Set<DirectiveKind>([
    "machine",
    "context",
    "event",
    "guard",
    "action",
    "delay",
]);

/** Source position of one body line: the line number and the 1-based column where the body text starts. */
export interface BodyLinePosition {
    line: number;
    column: number;
}

/** A directive body with the source position of each of its lines (for mapping syntax diagnostics back). */
export interface BodySource {
    text: string;
    /** 1-based line of the directive itself. */
    line: number;
    /** One entry per line of `text`. */
    lines: BodyLinePosition[];
}

export interface DirectiveSet {
    machine: { id: string; line: number } | null;
    contextType: BodySource | null;
    contextInitial: BodySource | null;
    events: Map<string, BodySource>;
    guards: Map<string, BodySource>;
    actions: Map<string, BodySource>;
    delays: Map<string, BodySource>;
}

interface DirectiveHeader {
    kind: string;
    kindColumn: number;
    head: string | null;
    headColumn: number;
    /** `undefined` when there is no `:`; `""` when the colon is followed by nothing. */
    inline: string | undefined;
    inlineColumn: number;
}

interface RawBodyLine {
    text: string;
    line: number;
    column: number;
}

const HEADER_START = /^(\s*%%\s*@)([A-Za-z]*)/;
const HEAD = /^[ \t]+([^\s:]+)/;
const HORIZONTAL_SPACE = /^[ \t]*/;

function parseHeader(line: SourceLine): DirectiveHeader {
    const start = HEADER_START.exec(line.text);
    if (start === null) {
        throw new StatechartParseError("malformed directive line", { line: line.number });
    }
    const kind = start[2]!;
    const kindColumn = start[1]!.length + 1;
    let position = start[0].length;
    if (kind === "") {
        throw new StatechartParseError(
            "missing directive kind after `@` (machine, context, event, guard, action, delay)",
            {
                line: line.number,
                column: kindColumn,
            },
        );
    }

    let head: string | null = null;
    let headColumn = position + 1;
    const headMatch = HEAD.exec(line.text.slice(position));
    if (headMatch !== null) {
        head = headMatch[1]!;
        headColumn = position + headMatch[0].length - head.length + 1;
        position += headMatch[0].length;
    }
    position += HORIZONTAL_SPACE.exec(line.text.slice(position))![0].length;

    if (position === line.text.length) {
        return { kind, kindColumn, head, headColumn, inline: undefined, inlineColumn: position + 1 };
    }
    if (line.text[position] !== ":") {
        throw new StatechartParseError(
            `unexpected text in directive @${kind}: expected \`:\` followed by the body, or the end of the line`,
            { line: line.number, column: position + 1 },
        );
    }
    position += 1;
    position += HORIZONTAL_SPACE.exec(line.text.slice(position))![0].length;
    return {
        kind,
        kindColumn,
        head,
        headColumn,
        inline: line.text.slice(position).trimEnd(),
        inlineColumn: position + 1,
    };
}

/**
 * A continuation line is `%%` followed by whitespace (or nothing). Returns the
 * raw content after `%%` (indent preserved) or `null` when the line ends the body.
 */
function continuationContent(line: SourceLine): RawBodyLine | null {
    const match = /^\s*%%/.exec(line.text);
    if (match === null || isDirectiveLine(line.text)) return null;
    const content = line.text.slice(match[0].length);
    if (content.trim() === "") return { text: "", line: line.number, column: match[0].length + 1 };
    if (!/^\s/.test(content)) return null;
    return { text: content.trimEnd(), line: line.number, column: match[0].length + 1 };
}

function leadingWhitespace(text: string): string {
    return /^\s*/.exec(text)![0];
}

function commonPrefix(a: string, b: string): string {
    let length = 0;
    while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
    return a.slice(0, length);
}

/** Drops leading / trailing empty lines and removes the common indent of the remaining ones. */
function normalizeContinuation(lines: RawBodyLine[]): RawBodyLine[] {
    let first = 0;
    let last = lines.length;
    while (first < last && lines[first]!.text === "") first += 1;
    while (last > first && lines[last - 1]!.text === "") last -= 1;
    const kept = lines.slice(first, last);
    const nonEmpty = kept.filter((entry) => entry.text !== "");
    if (nonEmpty.length === 0) return [];
    const indent = nonEmpty
        .map((entry) => leadingWhitespace(entry.text))
        .reduce((prefix, current) => commonPrefix(prefix, current));
    return kept.map((entry) =>
        entry.text === ""
            ? entry
            : { text: entry.text.slice(indent.length), line: entry.line, column: entry.column + indent.length },
    );
}

function assembleBody(header: DirectiveHeader, directiveLine: number, continuation: RawBodyLine[]): BodySource | null {
    const bodyLines: RawBodyLine[] = [];
    if (header.inline !== undefined && header.inline !== "") {
        bodyLines.push({ text: header.inline, line: directiveLine, column: header.inlineColumn });
    }
    bodyLines.push(...normalizeContinuation(continuation));
    if (bodyLines.length === 0) return null;
    return {
        text: bodyLines.map((entry) => entry.text).join("\n"),
        line: directiveLine,
        lines: bodyLines.map((entry) => ({ line: entry.line, column: entry.column })),
    };
}

function requireName(kind: string, head: string | null, line: number, column: number): string {
    if (head === null) {
        throw new StatechartParseError(`directive @${kind} requires a name: \`@${kind} NAME: ...\``, { line, column });
    }
    if (!isName(head)) {
        throw new StatechartParseError(`invalid name ${JSON.stringify(head)} in directive @${kind}: ${NAME_HINT}`, {
            line,
            column,
        });
    }
    return head;
}

function requireBody(kind: string, head: string | null, body: BodySource | null, line: number): BodySource {
    if (body === null) {
        const name = head === null ? `@${kind}` : `@${kind} ${head}`;
        throw new StatechartParseError(`directive ${name} has an empty body`, { line });
    }
    return body;
}

function declare(
    table: Map<string, BodySource>,
    kind: string,
    name: string,
    body: BodySource,
    line: number,
    column: number,
): void {
    const previous = table.get(name);
    if (previous !== undefined) {
        throw new StatechartParseError(
            `duplicate directive @${kind} ${name} (first declared at line ${previous.line})`,
            {
                line,
                column,
            },
        );
    }
    table.set(name, body);
}

/** Collects every directive of the text; throws on the first malformed or duplicate one. */
export function parseDirectives(lines: SourceLine[]): DirectiveSet {
    const set: DirectiveSet = {
        machine: null,
        contextType: null,
        contextInitial: null,
        events: new Map(),
        guards: new Map(),
        actions: new Map(),
        delays: new Map(),
    };

    let index = 0;
    while (index < lines.length) {
        const line = lines[index]!;
        if (isInitDirectiveLine(line.text)) {
            throw new StatechartParseError("mermaid init directives (`%%{ ... }%%`) are not supported", {
                line: line.number,
            });
        }
        if (!isDirectiveLine(line.text)) {
            index += 1;
            continue;
        }

        const header = parseHeader(line);
        const continuation: RawBodyLine[] = [];
        index += 1;
        while (index < lines.length) {
            const next = lines[index]!;
            if (isInitDirectiveLine(next.text)) break;
            const content = continuationContent(next);
            if (content === null) break;
            continuation.push(content);
            index += 1;
        }
        const body = assembleBody(header, line.number, continuation);
        applyDirective(set, header, body, line.number);
    }
    return set;
}

function applyDirective(set: DirectiveSet, header: DirectiveHeader, body: BodySource | null, line: number): void {
    const { kind, head } = header;
    if (!DIRECTIVE_KINDS.has(kind)) {
        throw new StatechartParseError(
            `unknown directive @${kind} (expected machine, context, event, guard, action or delay)`,
            { line, column: header.kindColumn },
        );
    }
    switch (kind as DirectiveKind) {
        case "machine": {
            if (set.machine !== null) {
                throw new StatechartParseError(
                    `duplicate @machine directive (first declared at line ${set.machine.line})`,
                    { line, column: header.kindColumn },
                );
            }
            const id = requireName(kind, head, line, header.headColumn);
            if (body !== null) {
                throw new StatechartParseError("directive @machine does not take a body", {
                    line: body.lines[0]!.line,
                    column: body.lines[0]!.column,
                });
            }
            set.machine = { id, line };
            return;
        }
        case "context": {
            if (head !== "type" && head !== "initial") {
                throw new StatechartParseError(
                    `directive @context expects \`type\` or \`initial\`${head === null ? "" : `, got ${JSON.stringify(head)}`}`,
                    { line, column: header.headColumn },
                );
            }
            const checked = requireBody(kind, head, body, line);
            const slot = head === "type" ? "contextType" : "contextInitial";
            const previous = set[slot];
            if (previous !== null) {
                throw new StatechartParseError(
                    `duplicate directive @context ${head} (first declared at line ${previous.line})`,
                    { line, column: header.headColumn },
                );
            }
            set[slot] = checked;
            return;
        }
        case "event": {
            const name = requireName(kind, head, line, header.headColumn);
            if (RESERVED_TRIGGERS.has(name)) {
                throw new StatechartParseError(
                    `\`${name}\` is a reserved trigger keyword and cannot be an event name`,
                    { line, column: header.headColumn },
                );
            }
            declare(set.events, kind, name, requireBody(kind, head, body, line), line, header.headColumn);
            return;
        }
        case "guard":
            declare(
                set.guards,
                kind,
                requireName(kind, head, line, header.headColumn),
                requireBody(kind, head, body, line),
                line,
                header.headColumn,
            );
            return;
        case "action":
            declare(
                set.actions,
                kind,
                requireName(kind, head, line, header.headColumn),
                requireBody(kind, head, body, line),
                line,
                header.headColumn,
            );
            return;
        case "delay":
            declare(
                set.delays,
                kind,
                requireName(kind, head, line, header.headColumn),
                requireBody(kind, head, body, line),
                line,
                header.headColumn,
            );
            return;
    }
}
