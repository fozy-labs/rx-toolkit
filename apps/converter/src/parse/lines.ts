/** One line of the `.mmd` text; `number` is 1-based, `text` has no line terminator. */
export interface SourceLine {
    readonly number: number;
    readonly text: string;
}

/** Splits on `\n`, `\r\n` or `\r`; a trailing terminator yields a final empty line (harmless: blank lines are skipped). */
export function splitLines(text: string): SourceLine[] {
    return text.split(/\r\n|\r|\n/).map((line, index) => ({ number: index + 1, text: line }));
}

const COMMENT_LINE = /^\s*%%/;
const DIRECTIVE_LINE = /^\s*%%\s*@/;
const INIT_DIRECTIVE_LINE = /^\s*%%\{/;

/** `%%` at the start of the line (after indentation). Mermaid ignores such lines everywhere, note blocks included. */
export function isCommentLine(text: string): boolean {
    return COMMENT_LINE.test(text);
}

/** `%% @kind ...` — a directive of ours. */
export function isDirectiveLine(text: string): boolean {
    return DIRECTIVE_LINE.test(text);
}

/** `%%{ ... }%%` — a mermaid init directive, rejected by the converter. */
export function isInitDirectiveLine(text: string): boolean {
    return INIT_DIRECTIVE_LINE.test(text);
}
