/**
 * `tsc --strict` (plus `noUnusedLocals` / `noUnusedParameters`) over a
 * generated file held in memory, with `@fozy-labs/rx-toolkit` mapped onto the
 * library sources at HEAD (root `src/index.ts`, `@/*` → `src/*`) under the
 * root's own compiler options (`@fozy-labs/js-configs/typescript`, which
 * `<repo>/tsconfig.json` extends): `moduleResolution: bundler`, `lib` DOM +
 * ESNext, `jsx: react-jsx`.
 *
 * Every call builds one `ts.Program`, but the library files are parsed once
 * (shared source-file cache) and the previous program is handed over as
 * `oldProgram`, so a test file with many generated files stays fast.
 * `typecheckGenerated` reports the diagnostics of the generated file only;
 * `typecheckLibrary` proves once per run that the library itself is clean
 * under the root's options, which is what makes that restriction honest.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** The generated file's path: fixed, so that `oldProgram` can reuse the program structure between calls. */
const VIRTUAL_PATH = normalize(fileURLToPath(new URL("./__virtual__/generated.ts", import.meta.url)));

const OPTIONS: ts.CompilerOptions = {
    // Root tsconfig (base + paths)
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.dom.d.ts", "lib.esnext.d.ts"],
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    isolatedModules: true,
    baseUrl: REPO_ROOT,
    paths: { "@fozy-labs/rx-toolkit": ["src/index.ts"], "@/*": ["src/*"] },
    typeRoots: [path.join(REPO_ROOT, "node_modules", "@types")],
    // What the generated file must pass on top
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
};

/** The root's own strictness: `noUnusedLocals` / `noUnusedParameters` are not part of it. */
const LIBRARY_OPTIONS: ts.CompilerOptions = { ...OPTIONS, noUnusedLocals: false, noUnusedParameters: false };

function normalize(fileName: string): string {
    return path.resolve(fileName).replace(/\\/g, "/");
}

function isVirtual(fileName: string): boolean {
    return normalize(fileName).toLowerCase() === VIRTUAL_PATH.toLowerCase();
}

/** Library and `.d.ts` files parsed once per process. */
const sourceFiles = new Map<string, ts.SourceFile>();
let previousProgram: ts.Program | undefined;

function createProgram(code: string, options: ts.CompilerOptions): ts.Program {
    const host = ts.createCompilerHost(options, true);
    const getSourceFile = host.getSourceFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const readFile = host.readFile.bind(host);
    host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
        if (isVirtual(fileName)) return ts.createSourceFile(fileName, code, languageVersionOrOptions, true);
        const key = normalize(fileName);
        let sourceFile = sourceFiles.get(key);
        if (sourceFile === undefined) {
            sourceFile = getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
            if (sourceFile !== undefined) sourceFiles.set(key, sourceFile);
        }
        return sourceFile;
    };
    host.fileExists = (fileName) => isVirtual(fileName) || fileExists(fileName);
    host.readFile = (fileName) => (isVirtual(fileName) ? code : readFile(fileName));

    const program = ts.createProgram({ rootNames: [VIRTUAL_PATH], options, host, oldProgram: previousProgram });
    previousProgram = program;
    return program;
}

function format(diagnostic: ts.Diagnostic, name: string): string {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (diagnostic.file === undefined || diagnostic.start === undefined) return `TS${diagnostic.code}: ${message}`;
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const fileName = isVirtual(diagnostic.file.fileName)
        ? name
        : path.relative(REPO_ROOT, diagnostic.file.fileName).replace(/\\/g, "/");
    return `${fileName}(${line + 1},${character + 1}): TS${diagnostic.code}: ${message}`;
}

/** Diagnostics of the generated file (`name` is used in the messages) plus any option / global diagnostic. */
export function typecheckGenerated(code: string, name = "generated.ts"): string[] {
    const program = createProgram(code, OPTIONS);
    const generated = program.getSourceFile(VIRTUAL_PATH);
    if (generated === undefined) throw new Error("the generated file did not make it into the program");
    return [
        ...program.getOptionsDiagnostics(),
        ...program.getGlobalDiagnostics(),
        ...program.getSyntacticDiagnostics(generated),
        ...program.getSemanticDiagnostics(generated),
    ].map((diagnostic) => format(diagnostic, name));
}

/** Diagnostics of every file but the generated one — the library sources under the root's options; expected empty. */
export function typecheckLibrary(code: string): string[] {
    const program = createProgram(code, LIBRARY_OPTIONS);
    return ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.file === undefined || !isVirtual(diagnostic.file.fileName))
        .map((diagnostic) => format(diagnostic, "generated.ts"));
}
