/**
 * Structural validation of a parsed diagram with the library's
 * `createMachine` — the proposal's gate: an invalid machine fails at
 * conversion, not at runtime. Implementation names are out of scope here:
 * the parser already rejects undeclared guard / action / delay names, and
 * the library checks the tables lazily when a machine starts.
 */
import { createMachine } from "@fozy-labs/rx-toolkit";

import { isCommentLine, splitLines } from "./parse/lines.js";
import { StatechartParseError } from "./StatechartParseError.js";
import { type ParseResult } from "./types.js";

const HEADER = "stateDiagram-v2";

/**
 * The library's `MachineConfigError`, matched by shape: a consumer (the viz)
 * may hold another module instance of the library, so `instanceof` would
 * not do.
 */
interface MachineConfigErrorLike {
    name: "MachineConfigError";
    message: string;
    /** Config path of the object owning the problem (`states.a.on.X[1]`); `""` for the root. */
    path: string;
}

function isMachineConfigError(error: unknown): error is MachineConfigErrorLike {
    if (typeof error !== "object" || error === null) return false;
    const { name, path, message } = error as { name?: unknown; path?: unknown; message?: unknown };
    return name === "MachineConfigError" && typeof path === "string" && typeof message === "string";
}

/** `states.working.states.green.on.X[1]` → `working.green`; a path with no leading `states.<key>` pairs → `""` (root). */
export function statePathOfConfigPath(configPath: string): string {
    const segments = configPath.split(".");
    const keys: string[] = [];
    for (let index = 0; index + 1 < segments.length && segments[index] === "states"; index += 2) {
        keys.push(segments[index + 1]!);
    }
    return keys.join(".");
}

/** Line of the `stateDiagram-v2` header: the first non-blank, non-`%%` line; 1 when the text has no header. */
function headerLineOf(source: string): number {
    for (const line of splitLines(source)) {
        const trimmed = line.text.trim();
        if (trimmed === "" || isCommentLine(line.text)) continue;
        return trimmed === HEADER ? line.number : 1;
    }
    return 1;
}

/** Line of the state at `path`, else of its nearest listed ancestor (`$final` states are not listed); the header line for the root. */
function lineOf(parsed: ParseResult, path: string): number {
    for (let current = path; current !== ""; current = current.slice(0, Math.max(0, current.lastIndexOf(".")))) {
        const state = parsed.states.find((candidate) => candidate.path === current);
        if (state !== undefined) return state.line;
    }
    return headerLineOf(parsed.config.source);
}

/**
 * Runs `createMachine` over `parsed.config` (with a placeholder `context: {}`
 * and no implementations, on a copy — `createMachine` freezes what it
 * accepts). The library's config error becomes a `StatechartParseError`:
 * `message` is the library's, `path` is the state the error belongs to
 * (`states.working.states.green.on.X[1]` → `working.green`; the root has
 * none), `line` is that state's `StateInfo.line` (the header line for the
 * root). Any other error propagates unchanged.
 */
export function validateMachineConfig(parsed: ParseResult): void {
    try {
        createMachine({ ...structuredClone(parsed.config), context: {} });
    } catch (error) {
        if (!isMachineConfigError(error)) throw error;
        const path = statePathOfConfigPath(error.path);
        throw new StatechartParseError(error.message, { line: lineOf(parsed, path), path });
    }
}
