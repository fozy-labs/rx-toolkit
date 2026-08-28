/**
 * Transition label micro-grammar (proposal, section «Грамматика подписи перехода»):
 *
 * ```
 * label   := trigger? guard? actions?
 * trigger := EVENT | "after" (INT | NAME) | "done"
 * guard   := "[" NAME "]"
 * actions := "/" NAME ("," NAME)*
 * EVENT   := NAME
 * NAME    := [A-Za-z_][A-Za-z0-9_]*
 * INT     := [0-9]+
 * ```
 *
 * The alphabet is NAME, digits, `[ ] / ,` and whitespace; anything else is an
 * error (mermaid silently truncates a label at `;`, for instance). Name
 * resolution against the directives happens in the builder.
 */
import { StatechartParseError } from "../StatechartParseError.js";

import { INT_PATTERN, isName, NAME_HINT } from "./names.js";

export type Trigger =
    | { kind: "event"; name: string; column: number }
    | { kind: "after"; delay: string; named: boolean; column: number }
    | { kind: "done"; column: number };

export interface NamedReference {
    name: string;
    column: number;
}

export interface TransitionLabel {
    trigger: Trigger | null;
    guard: NamedReference | null;
    actions: NamedReference[];
}

interface Token {
    type: "word" | "[" | "]" | "/" | ",";
    text: string;
    column: number;
}

const WORD = /[A-Za-z0-9_]+/y;

function tokenize(text: string, line: number, baseColumn: number): Token[] {
    const tokens: Token[] = [];
    let index = 0;
    while (index < text.length) {
        const char = text[index]!;
        if (char === " " || char === "\t") {
            index += 1;
            continue;
        }
        const column = baseColumn + index;
        if (char === "[" || char === "]" || char === "/" || char === ",") {
            tokens.push({ type: char, text: char, column });
            index += 1;
            continue;
        }
        WORD.lastIndex = index;
        const word = WORD.exec(text);
        if (word === null) {
            throw new StatechartParseError(
                `unexpected character ${JSON.stringify(char)} in transition label: allowed are names, digits, \`[ ] / ,\` and spaces`,
                { line, column },
            );
        }
        tokens.push({ type: "word", text: word[0], column });
        index += word[0].length;
    }
    return tokens;
}

class LabelParser {
    private index = 0;

    constructor(
        private readonly tokens: Token[],
        private readonly line: number,
        private readonly endColumn: number,
    ) {}

    parse(): TransitionLabel {
        const trigger = this.parseTrigger();
        const guard = this.parseGuard();
        const actions = this.parseActions();
        const extra = this.peek();
        if (extra !== null) {
            throw new StatechartParseError(
                `unexpected ${JSON.stringify(extra.text)} in transition label: expected \`[guard]\`, \`/ actions\` or the end of the label`,
                { line: this.line, column: extra.column },
            );
        }
        return { trigger, guard, actions };
    }

    private peek(): Token | null {
        return this.tokens[this.index] ?? null;
    }

    private next(): Token | null {
        const token = this.peek();
        if (token !== null) this.index += 1;
        return token;
    }

    private fail(message: string, token: Token | null): never {
        throw new StatechartParseError(message, {
            line: this.line,
            column: token === null ? this.endColumn : token.column,
        });
    }

    private expectName(token: Token | null, what: string): NamedReference {
        if (token === null || token.type !== "word") {
            this.fail(`expected ${what}${token === null ? "" : `, got ${JSON.stringify(token.text)}`}`, token);
        }
        if (!isName(token.text)) {
            this.fail(`invalid ${what} ${JSON.stringify(token.text)}: ${NAME_HINT}`, token);
        }
        return { name: token.text, column: token.column };
    }

    private parseTrigger(): Trigger | null {
        const token = this.peek();
        if (token === null || token.type !== "word") return null;
        this.next();
        if (token.text === "after") {
            const delay = this.next();
            if (delay === null || delay.type !== "word") {
                this.fail("`after` requires a delay: `after <milliseconds>` or `after <delayName>`", delay);
            }
            if (/^[0-9]+$/.test(delay.text)) {
                if (!INT_PATTERN.test(delay.text)) {
                    this.fail(`invalid delay ${JSON.stringify(delay.text)}: no leading zeros`, delay);
                }
                return { kind: "after", delay: delay.text, named: false, column: token.column };
            }
            if (!isName(delay.text) || delay.text === "after" || delay.text === "done") {
                this.fail(`invalid delay ${JSON.stringify(delay.text)}: expected an integer or a delay name`, delay);
            }
            return { kind: "after", delay: delay.text, named: true, column: token.column };
        }
        if (token.text === "done") {
            return { kind: "done", column: token.column };
        }
        if (!isName(token.text)) {
            this.fail(`invalid event name ${JSON.stringify(token.text)}: ${NAME_HINT}`, token);
        }
        return { kind: "event", name: token.text, column: token.column };
    }

    private parseGuard(): NamedReference | null {
        const open = this.peek();
        if (open === null || open.type !== "[") return null;
        this.next();
        const name = this.expectName(this.next(), "a guard name inside `[ ]`");
        const close = this.next();
        if (close === null || close.type !== "]") {
            this.fail("expected `]` after the guard name (inline expressions are not supported)", close);
        }
        return name;
    }

    private parseActions(): NamedReference[] {
        const slash = this.peek();
        if (slash === null || slash.type !== "/") return [];
        this.next();
        const actions: NamedReference[] = [this.expectName(this.next(), "an action name after `/`")];
        while (this.peek()?.type === ",") {
            this.next();
            actions.push(this.expectName(this.next(), "an action name after `,`"));
        }
        return actions;
    }
}

/**
 * Parses a label; `column` is the 1-based column of `text` in its source line
 * so that errors point at the exact character.
 */
export function parseLabel(text: string, line: number, column: number): TransitionLabel {
    const tokens = tokenize(text, line, column);
    return new LabelParser(tokens, line, column + text.length).parse();
}
