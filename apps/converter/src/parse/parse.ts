import { type ParseResult } from "../types.js";

import { buildParseResult } from "./build.js";
import { parseDiagram } from "./diagram.js";
import { parseDirectives, type DirectiveSet } from "./directives.js";
import { splitLines } from "./lines.js";
import { checkBodySyntax } from "./syntaxCheck.js";

function checkBodies(directives: DirectiveSet): void {
    if (directives.contextType !== null) checkBodySyntax(directives.contextType, "type", "@context type");
    if (directives.contextInitial !== null)
        checkBodySyntax(directives.contextInitial, "expression", "@context initial");
    for (const [name, body] of directives.events) checkBodySyntax(body, "type", `@event ${name}`);
    for (const [name, body] of directives.guards) checkBodySyntax(body, "expression", `@guard ${name}`);
    for (const [name, body] of directives.actions) checkBodySyntax(body, "statements", `@action ${name}`);
    for (const [name, body] of directives.delays) checkBodySyntax(body, "expression", `@delay ${name}`);
}

/**
 * Parses a `.mmd` text: directives, the `stateDiagram-v2` subset, transition
 * labels, name resolution and the syntax of every body. Throws
 * `StatechartParseError` on the first problem.
 */
export function parse(text: string): ParseResult {
    const lines = splitLines(text);
    const directives = parseDirectives(lines);
    const diagram = parseDiagram(lines);
    const result = buildParseResult(diagram, directives, text);
    checkBodies(directives);
    return result;
}
