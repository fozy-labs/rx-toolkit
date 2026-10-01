// @vitest-environment node
/// <reference types="node" />
/**
 * The type surface the forms module adds to the package root: the vocabulary a user writes and
 * every type a consumer's declaration may have to name (`declarations/`). Type-level machinery —
 * helpers, checks and the error strings they show — stays module-internal, as in the statechart
 * module.
 */
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FORM = join(ROOT, "src/form") + sep;

const PUBLIC_TYPES = [
    // common
    "InitializeOptions",
    "Parsed",
    "ParsedOk",
    "PendingQueries",
    "SchemaInput",
    "SchemaOutput",
    "ShowErrors",
    "SubmitStatus",
    // context
    "ContextView",
    "FieldQueryCtx",
    "FieldValidateCtx",
    "FieldView",
    "GroupComputedCtx",
    "GroupDisabledCtx",
    "GroupQueryCtx",
    "GroupValidateCtx",
    "GroupView",
    "IssueCollector",
    "IssueCollectors",
    "ItemView",
    "ListValidateCtx",
    "ListView",
    "NodeView",
    "SubmitCtx",
    // definition
    "AnyDef",
    "AnyFieldDef",
    "AnyGroupDef",
    "AnyItemDef",
    "AnyListDef",
    "Children",
    "ContextRequirement",
    "Definition",
    "FieldDef",
    "FieldOptions",
    "FormContextToken",
    "GroupDef",
    "GroupOptions",
    "IsRootOnly",
    "ListDef",
    "ListOptions",
    "MappedIssues",
    "SubmitResult",
    // infer
    "FormContext",
    "FormInit",
    "FormInitArgs",
    "FormInitial",
    "FormInput",
    "FormInstance",
    "FormNode",
    "FormOutput",
    // issue
    "Issue",
    "IssueInput",
    "IssueOptions",
    "IssuePath",
    "IssueSeverity",
    "IssueSource",
    // node
    "AnyNode",
    "ComputedSignals",
    "FieldNode",
    "FieldState",
    "FormRootNode",
    "FormState",
    "GroupNode",
    "GroupNodeBase",
    "GroupState",
    "ItemNode",
    "ItemRef",
    "ListNode",
    "ListState",
    "NodeBase",
    "SubmissionState",
    // plugin
    "FormsApi",
    "FormsPluginHKT",
    "FormsPluginOptions",
    // query
    "QueryNode",
    "QueryNodes",
    "QueryState",
    "QueryView",
    "QueryViews",
    // react
    "FormReactInstanceMembers",
    "FormReactMembers",
    "FormsReactPluginHKT",
    "UseFormOptions",
];

const RUNTIME = [
    "FormConfigError",
    "unstable_FormSignal",
    "unstable_FormsPlugin",
    "unstable_formsPlugin",
    "unstable_FormsReactPlugin",
    "unstable_formsReactPlugin",
];

/** The names the package root exports from `src/form`. */
function formExports(): string[] {
    const config = ts.getParsedCommandLineOfConfigFile(
        join(ROOT, "tsconfig.json"),
        {},
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
            },
        },
    )!;
    const entry = join(ROOT, "src/index.ts");
    const program = ts.createProgram([entry], config.options);
    const checker = program.getTypeChecker();
    const module = checker.getSymbolAtLocation(program.getSourceFile(entry)!)!;

    return checker
        .getExportsOfModule(module)
        .filter((symbol) => {
            const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            return target.declarations?.some((declaration) =>
                resolve(declaration.getSourceFile().fileName).startsWith(FORM),
            );
        })
        .map((symbol) => symbol.name)
        .sort();
}

describe("forms module exports (@/index)", () => {
    it("exports the forms vocabulary and no type-level machinery", { timeout: 60_000 }, () => {
        expect(formExports()).toEqual([...PUBLIC_TYPES, ...RUNTIME].sort());
    });
});
