/**
 * Line-based parser of the `stateDiagram-v2` subset (proposal, section
 * «Подмножество Mermaid»). Produces the statement tree only — ownership of
 * states, targets and labels are resolved by the builder.
 *
 * Accepted statements: the `stateDiagram-v2` header, `[*] --> X`, `A --> B`,
 * `A --> B: label`, `A --> [*]`, `state X { … }`, `--` inside a block,
 * `state "desc" as X` (optionally opening a block), `state X <<choice>>`,
 * a bare `X` line (mermaid's plain state statement, as `toMermaid()` writes
 * for states no transition mentions), `note left|right of X: text`,
 * `note left|right of X … end note`, `direction`, `classDef`, `class`,
 * `:::class` on transition ends and bare ids (ignored).
 * Everything else — including constructs mermaid accepts but renders as
 * something else than written (history, fork/join, bare `state X`, labelled
 * initial transitions, `X : description`, front matter, `%%{init}`) — is an
 * error with the line.
 */
import { StatechartParseError } from "../StatechartParseError.js";

import { isCommentLine, type SourceLine } from "./lines.js";
import { isName, NAME_HINT, PSEUDO_STATE } from "./names.js";

export interface InitialStatement {
    kind: "initial";
    line: number;
    target: string;
    targetColumn: number;
}

export interface TransitionStatement {
    kind: "transition";
    line: number;
    source: string;
    sourceColumn: number;
    /** `null` = `[*]` (the final pseudo-state of the enclosing block). */
    target: string | null;
    targetColumn: number;
    /** Text after `:`; `null` when absent or empty. */
    label: string | null;
    labelColumn: number;
}

export interface DescriptionStatement {
    kind: "description";
    line: number;
    id: string;
    idColumn: number;
    description: string;
}

export interface ChoiceStatement {
    kind: "choice";
    line: number;
    id: string;
    idColumn: number;
}

export interface BlockStatement {
    kind: "block";
    line: number;
    endLine: number;
    id: string;
    idColumn: number;
    /** From `state "desc" as X {`. */
    description: string | null;
    /** One entry without `--`; two or more with `--` (parallel regions), in source order. */
    regions: Statement[][];
    hasDividers: boolean;
}

export interface NoteStatement {
    kind: "note";
    line: number;
    id: string;
    idColumn: number;
}

/** A bare id on its own line — mermaid's plain state statement (declares the state in the scope). */
export interface DeclarationStatement {
    kind: "declaration";
    line: number;
    id: string;
    idColumn: number;
}

export interface IgnoredStatement {
    kind: "ignored";
    line: number;
    keyword: "direction" | "classDef" | "class";
}

export type Statement =
    | InitialStatement
    | TransitionStatement
    | DescriptionStatement
    | ChoiceStatement
    | BlockStatement
    | NoteStatement
    | DeclarationStatement
    | IgnoredStatement;

export interface Diagram {
    headerLine: number;
    statements: Statement[];
}

const HEADER = "stateDiagram-v2";
const REGION_DIVIDER = "--";
const CLASS_SUFFIX = ":::";

interface BlockContext {
    id: string;
    line: number;
}

function fail(message: string, line: number, column?: number): never {
    throw new StatechartParseError(message, column === undefined ? { line } : { line, column });
}

/** Validates a state id written in the diagram; `column` is 1-based. */
function checkStateId(id: string, line: number, column: number): string {
    if (id === "[H]" || id === "[H*]") {
        fail("history states (`[H]`, `[H*]`) are not supported", line, column);
    }
    if (id.startsWith("$")) {
        fail(
            `state id ${JSON.stringify(id)} is reserved: ids starting with \`$\` are synthetic (\`$final\`, \`$0\`)`,
            line,
            column,
        );
    }
    if (!isName(id)) {
        fail(`invalid state id ${JSON.stringify(id)}: ${NAME_HINT}`, line, column);
    }
    return id;
}

/** Strips a trailing `:::className` (ignored by the converter). */
function stripClass(token: string): string {
    const index = token.indexOf(CLASS_SUFFIX);
    return index === -1 ? token : token.slice(0, index);
}

class DiagramParser {
    private index = 0;

    constructor(private readonly lines: SourceLine[]) {}

    parse(): Diagram {
        const headerLine = this.parseHeader();
        const regions = this.parseBody(null);
        return { headerLine, statements: regions[0]! };
    }

    // --- header --------------------------------------------------------------

    private parseHeader(): number {
        while (this.index < this.lines.length) {
            const line = this.lines[this.index]!;
            const trimmed = line.text.trim();
            if (trimmed === "" || isCommentLine(line.text)) {
                this.index += 1;
                continue;
            }
            if (trimmed === HEADER) {
                this.index += 1;
                return line.number;
            }
            if (trimmed === "---") {
                fail("YAML front matter is not supported; use `%% @…` directives instead", line.number);
            }
            if (trimmed.startsWith(HEADER)) {
                fail(
                    `unexpected text after the \`${HEADER}\` header (mermaid would read it as a state id)`,
                    line.number,
                );
            }
            if (/^stateDiagram\b/.test(trimmed)) {
                fail(`only \`${HEADER}\` diagrams are supported`, line.number);
            }
            fail(`expected the \`${HEADER}\` header, got ${JSON.stringify(trimmed)}`, line.number);
        }
        fail(`missing \`${HEADER}\` header`, Math.max(1, this.lines.length));
    }

    // --- blocks --------------------------------------------------------------

    /** Parses statements until `}` (block) or end of input (root); returns the regions split by `--`. */
    private parseBody(block: BlockContext | null): Statement[][] {
        const regions: Statement[][] = [[]];
        while (this.index < this.lines.length) {
            const line = this.lines[this.index]!;
            const trimmed = line.text.trim();
            if (trimmed === "" || isCommentLine(line.text)) {
                this.index += 1;
                continue;
            }
            if (trimmed === "}") {
                if (block === null) fail("unexpected `}` at the root of the diagram", line.number);
                this.index += 1;
                return regions;
            }
            if (trimmed === REGION_DIVIDER) {
                if (block === null) {
                    fail("`--` (parallel regions) is only allowed inside a `state X { }` block", line.number);
                }
                regions.push([]);
                this.index += 1;
                continue;
            }
            this.index += 1;
            regions[regions.length - 1]!.push(this.parseStatement(line));
        }
        if (block !== null) {
            fail(`unclosed block of state \`${block.id}\` (missing \`}\`)`, block.line);
        }
        return regions;
    }

    private parseStatement(line: SourceLine): Statement {
        const text = line.text;
        const trimmed = text.trim();
        if (/^state(\s|"|$)/.test(trimmed)) return this.parseStateStatement(line);
        if (/^note(\s|"|$)/.test(trimmed)) return this.parseNote(line);
        if (/^direction(\s|$)/.test(trimmed)) {
            if (!/^direction\s+(TB|TD|BT|RL|LR)$/.test(trimmed)) {
                fail("invalid `direction` statement: expected TB, TD, BT, RL or LR", line.number);
            }
            return { kind: "ignored", line: line.number, keyword: "direction" };
        }
        if (/^classDef\s/.test(trimmed)) return { kind: "ignored", line: line.number, keyword: "classDef" };
        if (/^class\s/.test(trimmed)) return { kind: "ignored", line: line.number, keyword: "class" };
        if (text.includes("-->")) return this.parseTransition(line);
        if (/^[^\s:]+\s*:(?!::)/.test(trimmed)) {
            fail('`X : description` is not supported; use `state "description" as X`', line.number);
        }
        if (/^\S+$/.test(trimmed)) {
            const idColumn = text.indexOf(trimmed) + 1;
            const id = checkStateId(stripClass(trimmed), line.number, idColumn);
            return { kind: "declaration", line: line.number, id, idColumn };
        }
        fail(`unsupported statement ${JSON.stringify(trimmed)}`, line.number);
    }

    // --- state statements --------------------------------------------------

    private parseStateStatement(line: SourceLine): Statement {
        const text = line.text;
        const start = /^\s*state\s*/.exec(text)![0].length;
        const rest = text.slice(start);

        if (rest.startsWith('"')) return this.parseDescribedState(line, start);

        const idMatch = /^([^\s<{]+)/.exec(rest);
        if (idMatch === null) fail("malformed `state` statement", line.number, start + 1);
        const idToken = idMatch[1]!;
        const idColumn = start + 1;
        const afterId = rest.slice(idToken.length);
        const tail = afterId.trim();

        if (idToken.includes(CLASS_SUFFIX)) {
            fail("`:::class` is only supported on transition ends, not in `state` declarations", line.number, idColumn);
        }

        if (tail === "{") {
            const id = checkStateId(idToken, line.number, idColumn);
            return this.parseBlock(line, id, idColumn, null);
        }
        const stereotype = /^<<\s*([^>]*?)\s*>>$/.exec(tail);
        if (stereotype !== null) {
            const id = checkStateId(idToken, line.number, idColumn);
            const name = stereotype[1]!;
            const stereotypeColumn = start + idToken.length + afterId.indexOf("<<") + 1;
            if (name === "choice") return { kind: "choice", line: line.number, id, idColumn };
            if (name === "fork" || name === "join") {
                fail(
                    `\`<<${name}>>\` is not supported in v1: enter parallel regions through their own \`[*]\``,
                    line.number,
                    stereotypeColumn,
                );
            }
            fail(
                `unsupported stereotype \`<<${name}>>\` (only \`<<choice>>\` is supported)`,
                line.number,
                stereotypeColumn,
            );
        }
        if (tail === "") {
            fail(
                `bare \`state ${idToken}\` declares nothing in mermaid; mention the state in a transition or use \`state "description" as ${idToken}\``,
                line.number,
                idColumn,
            );
        }
        if (tail.startsWith("{")) {
            fail(
                "a state block must open with `{` at the end of its line and close with `}` on its own line",
                line.number,
                idColumn,
            );
        }
        fail(`unsupported \`state\` statement ${JSON.stringify(text.trim())}`, line.number);
    }

    /** `state "desc" as X` / `state "desc" as X {`. */
    private parseDescribedState(line: SourceLine, start: number): Statement {
        const text = line.text;
        const match = /^"([^"]*)"\s+as\s+/.exec(text.slice(start));
        if (match === null) {
            fail('malformed description: expected `state "description" as X`', line.number, start + 1);
        }
        const description = match[1]!;
        const idStart = start + match[0].length;
        const rest = text.slice(idStart);
        const idMatch = /^([^\s<{]+)/.exec(rest);
        if (idMatch === null)
            fail('missing state id after `as` in `state "description" as X`', line.number, idStart + 1);
        const idToken = idMatch[1]!;
        const idColumn = idStart + 1;
        const tail = rest.slice(idToken.length).trim();
        if (idToken.includes(CLASS_SUFFIX)) {
            fail("`:::class` is only supported on transition ends, not in `state` declarations", line.number, idColumn);
        }
        if (tail.startsWith("<<")) {
            fail(
                'a choice state cannot have a description (mermaid does not support `state "desc" as X <<choice>>`)',
                line.number,
                idColumn,
            );
        }
        const id = checkStateId(idToken, line.number, idColumn);
        if (tail === "") return { kind: "description", line: line.number, id, idColumn, description };
        if (tail === "{") return this.parseBlock(line, id, idColumn, description);
        if (tail.startsWith("{")) {
            fail(
                "a state block must open with `{` at the end of its line and close with `}` on its own line",
                line.number,
                idColumn,
            );
        }
        fail(`unsupported \`state\` statement ${JSON.stringify(text.trim())}`, line.number);
    }

    private parseBlock(line: SourceLine, id: string, idColumn: number, description: string | null): BlockStatement {
        const regions = this.parseBody({ id, line: line.number });
        const endLine = this.lines[this.index - 1]!.number;
        return {
            kind: "block",
            line: line.number,
            endLine,
            id,
            idColumn,
            description,
            regions,
            hasDividers: regions.length > 1,
        };
    }

    // --- notes -------------------------------------------------------------

    private parseNote(line: SourceLine): NoteStatement {
        const text = line.text;
        const match = /^(\s*note\s+(?:left|right)\s+of\s+)([^\s:]+)\s*(:.*)?$/.exec(text);
        if (match === null) {
            fail(
                "unsupported `note` statement: expected `note left|right of X: text` or a `note … end note` block",
                line.number,
            );
        }
        const idColumn = match[1]!.length + 1;
        const id = checkStateId(match[2]!, line.number, idColumn);
        if (match[3] === undefined) {
            // Block note: everything up to a line that is exactly `end note` is note text.
            while (this.index < this.lines.length) {
                const current = this.lines[this.index]!;
                this.index += 1;
                if (current.text.trim() === "end note") {
                    return { kind: "note", line: line.number, id, idColumn };
                }
            }
            fail("unterminated note block (missing `end note`)", line.number);
        }
        const semicolon = match[3].indexOf(";");
        if (semicolon !== -1) {
            // Mermaid ends a single-line note at `;` and parses the rest of the line as statements.
            fail(
                "`;` is not allowed in a single-line note (mermaid ends the note there); use a `note … end note` block",
                line.number,
                text.length - match[3].length + semicolon + 1,
            );
        }
        return { kind: "note", line: line.number, id, idColumn };
    }

    // --- transitions -------------------------------------------------------

    private parseTransition(line: SourceLine): InitialStatement | TransitionStatement {
        const text = line.text;
        const semicolon = text.indexOf(";");
        if (semicolon !== -1) {
            // Mermaid reads `;` as a statement separator (and cuts labels there); one statement per line here.
            fail(
                "`;` is not allowed: mermaid reads it as a statement separator (one statement per line)",
                line.number,
                semicolon + 1,
            );
        }
        const arrow = text.indexOf("-->");
        const left = text.slice(0, arrow);
        const leftToken = left.trim();
        const leftColumn = left.indexOf(leftToken) + 1;
        if (leftToken === "") fail("missing source state before `-->`", line.number, leftColumn);

        let position = arrow + 3;
        while (position < text.length && (text[position] === " " || text[position] === "\t")) position += 1;
        const targetColumn = position + 1;
        const targetMatch = /^[^\s:]+/.exec(text.slice(position));
        if (targetMatch === null) fail("missing target state after `-->`", line.number, targetColumn);
        const targetToken = targetMatch[0];
        position += targetToken.length;
        // `:::class` directly after the target id (`b:::cls`) is ignored.
        let targetId = targetToken;
        if (text.startsWith(CLASS_SUFFIX, position)) {
            const classMatch = /^:::[^\s:]*/.exec(text.slice(position))!;
            position += classMatch[0].length;
        }
        while (position < text.length && (text[position] === " " || text[position] === "\t")) position += 1;

        let label: string | null = null;
        let labelColumn = position + 1;
        if (position < text.length) {
            if (text[position] !== ":") {
                fail(
                    `unexpected text after the target state ${JSON.stringify(text.slice(position).trim())}: expected \`: label\` or the end of the line (\`%%\` comments are only recognized at the start of a line)`,
                    line.number,
                    position + 1,
                );
            }
            position += 1;
            while (position < text.length && (text[position] === " " || text[position] === "\t")) position += 1;
            labelColumn = position + 1;
            const rawLabel = text.slice(position).trimEnd();
            label = rawLabel === "" ? null : rawLabel;
        }

        const sourceId = stripClass(leftToken);
        if (sourceId !== leftToken && leftToken.startsWith(PSEUDO_STATE)) {
            fail("`[*]` cannot carry a `:::class`", line.number, leftColumn);
        }
        targetId = stripClass(targetId);

        if (sourceId === PSEUDO_STATE) {
            if (targetId === PSEUDO_STATE) fail("`[*] --> [*]` is not supported", line.number, targetColumn);
            if (label !== null) {
                fail("an initial transition (`[*] --> X`) cannot have a label", line.number, labelColumn);
            }
            return {
                kind: "initial",
                line: line.number,
                target: checkStateId(targetId, line.number, targetColumn),
                targetColumn,
            };
        }
        const source = checkStateId(sourceId, line.number, leftColumn);
        const target = targetId === PSEUDO_STATE ? null : checkStateId(targetId, line.number, targetColumn);
        return {
            kind: "transition",
            line: line.number,
            source,
            sourceColumn: leftColumn,
            target,
            targetColumn,
            label,
            labelColumn,
        };
    }
}

export function parseDiagram(lines: SourceLine[]): Diagram {
    return new DiagramParser(lines).parse();
}
