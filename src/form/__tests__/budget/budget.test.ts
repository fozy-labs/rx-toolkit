// @vitest-environment node
/// <reference types="node" />
/**
 * Type budget of the form: the Types / Instantiations `fixture.ts` adds over its form-free twin
 * `twin.ts`, checked against the approved limits, and a breakdown by feature. Each feature is switched off by stubbing its type
 * declarations in a copy of `src/form` under `.tmp/form-type-budget/`, and its cost is the
 * difference against the full fixture. Time is printed for reference only, never compared.
 *
 * The fixture compiles against the declarations emitted for the copy of `src/form`, as a
 * consumer of the package does: the form's runtime code is not type-checked in its program.
 *
 * Skipped by default (it runs `tsc` eight times). Run it with:
 *
 *     FORM_TYPE_BUDGET=1 pnpm vitest run src/form/__tests__/budget --reporter=verbose
 *
 * The numbers depend on the pinned TypeScript version; re-measure after an upgrade.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const FORM = join(ROOT, "src/form");
const WORK = join(ROOT, ".tmp/form-type-budget");
const TSC = join(ROOT, "node_modules/typescript/bin/tsc");

// Budget approved by the owner: the delta measured on this fixture with TS 5.9.2
// (Types 5284, Instantiations 21432) plus 25%.
// That measurement also type-checked the builders' runtime code; against the declarations the
// same fixture costs less, and the limits stay as approved.
const MAX_TYPES_DELTA = 6600;
const MAX_INSTANTIATIONS_DELTA = 27000;

/** A declaration to replace: `export type <name><params> = <body>;` keeps its type parameters. */
interface Stub {
    file: string;
    name: string;
    body: string;
}

interface Feature {
    name: string;
    stubs: Stub[];
}

const ANY_SIGNALS = "{ readonly [name: `${string}$`]: ReadonlySignal<any> }";
const CONTEXTS = [
    "FieldQueryCtx",
    "FieldValidateCtx",
    "GroupComputedCtx",
    "GroupQueryCtx",
    "GroupDisabledCtx",
    "GroupValidateCtx",
    "ListValidateCtx",
    "SubmitCtx",
];

const FEATURES: Feature[] = [
    {
        name: "`$` aliases (`fields.<name>$`, `queries.<k>$`)",
        stubs: [
            { file: "types/node.ts", name: "NodeFields", body: `N & ${ANY_SIGNALS}` },
            { file: "types/query.ts", name: "QueryAliases", body: ANY_SIGNALS },
        ],
    },
    {
        name: "callback contexts and views",
        stubs: CONTEXTS.map((name) => ({ file: "types/context.ts", name, body: "any" })),
    },
    {
        name: "context requirement typing",
        stubs: [
            { file: "types/definition.ts", name: "ChildrenContext", body: "unknown" },
            { file: "types/definition.ts", name: "ContextCheck", body: "unknown" },
            { file: "types/definition.ts", name: "ContextRequirement", body: "Own" },
        ],
    },
    {
        name: "disabled keys (optional in value / output)",
        stubs: [{ file: "types/definition.ts", name: "WithOptionalKeys", body: "T" }],
    },
    {
        name: "name and root-only checks",
        stubs: [
            { file: "types/definition.ts", name: "InvalidName", body: "never" },
            { file: "types/definition.ts", name: "FieldsCheck", body: "unknown" },
        ],
    },
    {
        name: "query key checks (result, one resource)",
        stubs: [{ file: "types/definition.ts", name: "QueryKeyCheck", body: "unknown" }],
    },
];

interface Measure {
    types: number;
    instantiations: number;
    checkTime: string;
    errors: number;
}

function stub(text: string, file: string, { name, body }: Stub): string {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(
        (node): node is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
            (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name.text === name,
    );
    if (!declaration) throw new Error(`${file}: no declaration named ${name}`);
    const params = declaration.typeParameters
        ? `<${declaration.typeParameters.map((param) => param.getText(source)).join(", ")}>`
        : "";
    const replacement = `export type ${name}${params} = ${body};`;
    return text.slice(0, declaration.getStart(source)) + replacement + text.slice(declaration.getEnd());
}

/**
 * A copy of `src/form` with the stubs applied, reduced to its emitted declarations plus the
 * fixture and its api; `@/*` keeps resolving to the real `src`, as it does for the twin.
 */
function prepare(variant: string, stubs: Stub[]): string {
    const dir = join(WORK, variant);
    const form = join(dir, "src/form");
    const budget = join(form, "__tests__/budget");
    rmSync(dir, { recursive: true, force: true });
    cpSync(FORM, form, { recursive: true });
    for (const entry of stubs) {
        const path = join(form, entry.file);
        writeFileSync(path, stub(readFileSync(path, "utf8"), entry.file, entry));
    }
    emitDeclarations(join(form, "index.ts"), form);
    const keep = new Set([join(budget, "fixture.ts"), join(budget, "api.ts")]);
    for (const file of readdirSync(form, { recursive: true, encoding: "utf8" })) {
        const path = join(form, file);
        if (/\.tsx?$/.test(file) && !file.endsWith(".d.ts") && !keep.has(path)) rmSync(path);
    }
    return budget;
}

/** Emits the declarations of the form files `entry` reaches, next to their sources. */
function emitDeclarations(entry: string, form: string): void {
    const config = ts.getParsedCommandLineOfConfigFile(
        join(ROOT, "tsconfig.json"),
        {},
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
            },
        },
    );
    if (!config) throw new Error("tsconfig.json cannot be read");
    const { outDir: _outDir, ...options } = config.options;
    const program = ts.createProgram([entry], {
        ...options,
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        declarationMap: false,
    });
    const inForm = (file: string) => !relative(form, file).startsWith("..") && !file.includes("__tests__");
    for (const source of program.getSourceFiles()) {
        if (source.isDeclarationFile || !inForm(source.fileName)) continue;
        const result = program.emit(source, (file, text) => writeFileSync(file, text), undefined, true);
        if (result.emitSkipped) throw new Error(`no declarations for ${source.fileName}`);
    }
}

/**
 * `allowErrors`: a stub that widens a type to `any` leaves some reads of the fixture untyped;
 * their errors are counted and reported, not fatal.
 */
function measure(variant: string, file: string, allowErrors = false): Measure {
    const dir = join(WORK, variant);
    mkdirSync(dir, { recursive: true });
    const config = join(dir, "tsconfig.json");
    const toRoot = relative(dir, ROOT).replaceAll("\\", "/");
    writeFileSync(
        config,
        JSON.stringify({
            extends: `${toRoot}/tsconfig.json`,
            compilerOptions: { noEmit: true, types: [], baseUrl: toRoot, paths: { "@/*": ["src/*"] } },
            include: [],
            files: [relative(dir, file).replaceAll("\\", "/")],
        }),
    );
    let output: string;
    let errors = 0;
    try {
        output = execFileSync(process.execPath, [TSC, "-p", config, "--extendedDiagnostics"], { encoding: "utf8" });
    } catch (error) {
        output = (error as { stdout?: string }).stdout ?? String(error);
        errors = output.split("\n").filter((line) => / error TS\d+:/.test(line)).length;
        if (errors === 0 || !allowErrors) throw new Error(`${variant} does not compile:\n${output}`);
    }
    const read = (label: string) => output.match(new RegExp(`^${label}:\\s+(.+)$`, "m"))?.[1]?.trim() ?? "?";
    return {
        types: Number(read("Types")),
        instantiations: Number(read("Instantiations")),
        checkTime: read("Check time"),
        errors,
    };
}

function row(cells: (string | number)[]): string {
    return `| ${cells.join(" | ")} |`;
}

describe.runIf(process.env.FORM_TYPE_BUDGET)("form type budget", () => {
    it("measures the fixture against its twin, by feature", { timeout: 600_000 }, () => {
        const twin = measure("twin", join(FORM, "__tests__/budget/twin.ts"));
        const full = measure("full", join(prepare("full", []), "fixture.ts"));
        const features = FEATURES.map((feature, index) => {
            const variant = `without-${index + 1}`;
            const result = measure(variant, join(prepare(variant, feature.stubs), "fixture.ts"), true);
            return {
                name: feature.name,
                types: full.types - result.types,
                instantiations: full.instantiations - result.instantiations,
                errors: result.errors,
            };
        });

        const lines = [
            `TypeScript ${ts.version}`,
            "",
            row(["Program", "Types", "Instantiations", "Check time (reference)"]),
            row(["---", "---:", "---:", "---:"]),
            row(["fixture", full.types, full.instantiations, full.checkTime]),
            row(["twin", twin.types, twin.instantiations, twin.checkTime]),
            row(["delta", full.types - twin.types, full.instantiations - twin.instantiations, ""]),
            "",
            row(["Feature", "Types", "Instantiations", "Errors when switched off"]),
            row(["---", "---:", "---:", "---:"]),
            ...features.map((feature) => row([feature.name, feature.types, feature.instantiations, feature.errors])),
        ];
        console.log(lines.join("\n"));

        expect(full.types - twin.types).toBeLessThanOrEqual(MAX_TYPES_DELTA);
        expect(full.instantiations - twin.instantiations).toBeLessThanOrEqual(MAX_INSTANTIATIONS_DELTA);
    });
});
