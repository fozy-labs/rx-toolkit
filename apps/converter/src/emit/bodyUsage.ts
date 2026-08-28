/**
 * Which of the `{ context, event }` arguments a body actually reads. Decides
 * the destructuring of the emitted handler (only mentioned arguments, to keep
 * the generated file free of unused-variable noise) and whether an action
 * needs the Immer `mutate` wrapper. Computed on the parsed AST, so words in
 * strings, comments and property names (`x.context`) do not count.
 */
import ts from "typescript";

import { wrapBody, type BodyKind } from "../ts/wrapBody.js";

export interface BodyUsage {
    context: boolean;
    event: boolean;
}

function isReference(node: ts.Identifier): boolean {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
    if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
    if (ts.isQualifiedName(parent) && parent.right === node) return false;
    if (
        (ts.isPropertySignature(parent) ||
            ts.isPropertyDeclaration(parent) ||
            ts.isMethodDeclaration(parent) ||
            ts.isMethodSignature(parent) ||
            ts.isEnumMember(parent)) &&
        parent.name === node
    ) {
        return false;
    }
    if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
    return true;
}

export function analyzeBodyUsage(body: string, kind: Exclude<BodyKind, "type">): BodyUsage {
    const wrapped = wrapBody(body, kind);
    const sourceFile = ts.createSourceFile("body.ts", wrapped.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const statement = sourceFile.statements[0];
    const arrow =
        statement !== undefined && ts.isExpressionStatement(statement) && ts.isArrowFunction(statement.expression)
            ? statement.expression
            : null;
    const usage: BodyUsage = { context: false, event: false };
    if (arrow === null) return usage;

    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && isReference(node)) {
            if (node.text === "context") usage.context = true;
            else if (node.text === "event") usage.event = true;
        }
        ts.forEachChild(node, visit);
    };
    visit(arrow.body);
    return usage;
}
