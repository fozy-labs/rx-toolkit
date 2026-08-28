/**
 * Syntax check of directive bodies with the TypeScript compiler API
 * (proposal, «Открытые решения» → v1: syntactic check with the directive line).
 * Only parse diagnostics are reported — no type information is available at
 * this point; types are checked by `tsc` over the generated file.
 */
import ts from "typescript";

import { StatechartParseError } from "../StatechartParseError.js";
import { wrapBody, type BodyKind } from "../ts/wrapBody.js";

import { type BodySource } from "./directives.js";

const COMPILER_OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
};

function syntaxDiagnostics(text: string): readonly ts.Diagnostic[] {
    // `transpileModule` with `reportDiagnostics` returns exactly the parse diagnostics of the file.
    return (
        ts.transpileModule(text, { compilerOptions: COMPILER_OPTIONS, fileName: "body.ts", reportDiagnostics: true })
            .diagnostics ?? []
    );
}

/** Throws a `StatechartParseError` at the source position of the first syntax error of `body`. */
export function checkBodySyntax(body: BodySource, kind: BodyKind, what: string): void {
    const wrapped = wrapBody(body.text, kind);
    const diagnostics = syntaxDiagnostics(wrapped.text);
    if (diagnostics.length === 0) return;

    const diagnostic = diagnostics[0]!;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    const location = locate(body, wrapped.bodyLineOffset, diagnostic);
    throw new StatechartParseError(`syntax error in ${what}: ${message}`, location);
}

function locate(
    body: BodySource,
    bodyLineOffset: number,
    diagnostic: ts.Diagnostic,
): { line: number; column?: number } {
    if (diagnostic.file === undefined || diagnostic.start === undefined) return { line: body.line };
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const bodyLine = position.line - bodyLineOffset;
    if (bodyLine < 0) return { line: body.line };
    if (bodyLine >= body.lines.length) {
        // The error is on the closing line of the wrapper: something is left open at the end of the body.
        const last = body.lines[body.lines.length - 1]!;
        const lastText = body.text.split("\n")[body.lines.length - 1] ?? "";
        return { line: last.line, column: last.column + lastText.length };
    }
    const source = body.lines[bodyLine]!;
    return { line: source.line, column: source.column + position.character };
}
