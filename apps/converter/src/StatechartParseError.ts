export interface StatechartParseErrorLocation {
    /** 1-based line of the offending source line. */
    line: number;
    /** 1-based column, when the error can be pinned to a position inside the line. */
    column?: number;
    /** Config path of the construct (`"working.$0.a1"`), when the error belongs to a state or scope. */
    path?: string;
}

/**
 * The single error type of the converter. Every rejection of the `.mmd` text
 * (directives, diagram subset, transition labels, body syntax, emitter
 * preconditions) carries the source line so that a CLI can print
 * `file:line:column: message`.
 */
export class StatechartParseError extends Error {
    readonly line: number;
    readonly column: number | undefined;
    readonly path: string | undefined;

    constructor(message: string, location: StatechartParseErrorLocation) {
        super(message);
        this.name = "StatechartParseError";
        this.line = location.line;
        this.column = location.column;
        // The root scope has the empty path; an error there carries no path at all.
        this.path = location.path === "" ? undefined : location.path;
    }

    /** `line[:column]: message[ (at path)]` — the CLI prefixes it with the file name. */
    format(): string {
        const position = this.column === undefined ? `${this.line}` : `${this.line}:${this.column}`;
        const suffix = this.path === undefined ? "" : ` (at ${this.path})`;
        return `${position}: ${this.message}${suffix}`;
    }
}
