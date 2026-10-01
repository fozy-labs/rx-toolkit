// @vitest-environment node
/// <reference types="node" />
/**
 * Declaration emit of consumers: every consumer module next to this file compiles with
 * `declaration: true` against the package as it is published — the declarations of `src` built
 * by `tsc` and `tsc-alias` into a `node_modules/@fozy-labs/rx-toolkit` — with no error (TS2742,
 * TS4023, TS4058: a type the declaration cannot name), and its declaration refers to no module
 * but `@fozy-labs/rx-toolkit`.
 *
 * A consumer covers only the types it happens to reach, so the rule behind them is checked on the
 * package itself too: every type a published declaration refers to, at any depth, is published
 * from the root — or is module-local, which a consumer's declaration inlines. An exported type the
 * root leaves out has only its file path for a name (TS2742); a module-local interface has none.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const WORK = join(ROOT, ".tmp/declarations");
const PACKAGE = join(WORK, "node_modules/@fozy-labs/rx-toolkit");
const CONSUMER = join(WORK, "consumer");
const CONSUMERS = ["form", "query", "signals", "common", "statechart"];
/**
 * The modules whose published types are checked for unnamable references (package-relative):
 * the ones the rule of `types/index.ts` was applied to.
 */
const NAMED_MODULES = ["dist/form", "dist/query", "dist/signals", "dist/common", "dist/statechart"];
const TSC = join(ROOT, "node_modules/typescript/bin/tsc");
const TSC_ALIAS = join(ROOT, "node_modules/tsc-alias/dist/bin/index.js");

const posix = (path: string) => path.replaceAll("\\", "/");

function run(bin: string, args: string[]): void {
    try {
        execFileSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd: ROOT });
    } catch (error) {
        const { stdout, stderr } = error as { stdout?: string; stderr?: string };
        throw new Error(`${posix(relative(ROOT, bin))} failed:\n${stdout ?? ""}${stderr ?? ""}`);
    }
}

function writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2));
}

/** The published package: the declarations of `src`, aliases resolved as the build does. */
function buildPackage(): void {
    const config = join(WORK, "tsconfig.build.json");
    const toRoot = posix(relative(WORK, ROOT));
    writeJson(config, {
        extends: `${toRoot}/tsconfig.json`,
        compilerOptions: {
            outDir: posix(relative(WORK, join(PACKAGE, "dist"))),
            declaration: true,
            emitDeclarationOnly: true,
            declarationMap: false,
        },
        include: [`${toRoot}/src/**/*`],
        exclude: [`${toRoot}/src/**/*.test.ts`, `${toRoot}/src/**/__tests__/**`],
    });
    run(TSC, ["-p", config]);
    run(TSC_ALIAS, ["-p", config, "--resolve-full-paths"]);
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
    writeJson(join(PACKAGE, "package.json"), {
        name: manifest.name,
        type: manifest.type,
        main: manifest.main,
        types: manifest.types,
        exports: manifest.exports,
    });
}

/** The module specifiers a declaration file refers to. */
function specifiers(declaration: string): string[] {
    const found = new Set<string>();
    for (const match of declaration.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) found.add(match[1]);
    return [...found];
}

/**
 * The types that published declarations of a `module` refer to, directly or through module-local
 * types, and that a consumer's declaration could not name: exported from their file but not from
 * the root, or module-local interfaces and classes, which cannot be inlined.
 */
function unnamable(module: string): string[] {
    const scope = join(PACKAGE, module) + sep;
    const entry = join(PACKAGE, "dist/index.d.ts");
    const program = ts.createProgram([entry], {
        strict: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        types: [],
        noEmit: true,
    });
    const checker = program.getTypeChecker();
    const resolveAlias = (symbol: ts.Symbol) =>
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const inScope = (node: ts.Node) => resolve(node.getSourceFile().fileName).startsWith(scope);
    const root = checker.getSymbolAtLocation(program.getSourceFile(entry)!)!;
    const published = new Set(checker.getExportsOfModule(root).map(resolveAlias));

    const found = new Set<string>();
    const visited = new Set<ts.Symbol>();
    const queue = [...published].filter((symbol) => symbol.declarations?.some(inScope));
    const refer = (from: ts.Symbol, name: ts.Node) => {
        const referred = checker.getSymbolAtLocation(name);
        if (!referred) return;
        const symbol = resolveAlias(referred);
        const declaration = symbol.declarations?.find(inScope);
        if (!declaration || symbol.flags & ts.SymbolFlags.TypeParameter) return;
        queue.push(symbol);
        if (published.has(symbol)) return;
        const file = posix(relative(PACKAGE, declaration.getSourceFile().fileName));
        if (ts.getCombinedModifierFlags(declaration as ts.Declaration) & ts.ModifierFlags.Export) {
            found.add(`${symbol.name} (exported from ${file}, not from the root) <- ${from.name}`);
        } else if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
            found.add(`${symbol.name} (module-local interface in ${file}) <- ${from.name}`);
        }
    };
    while (queue.length > 0) {
        const symbol = queue.pop()!;
        if (visited.has(symbol)) continue;
        visited.add(symbol);
        const visit = (node: ts.Node): void => {
            if (ts.isTypeReferenceNode(node))
                refer(symbol, ts.isQualifiedName(node.typeName) ? node.typeName.right : node.typeName);
            else if (ts.isExpressionWithTypeArguments(node)) refer(symbol, node.expression);
            else if (ts.isTypeQueryNode(node))
                refer(symbol, ts.isQualifiedName(node.exprName) ? node.exprName.right : node.exprName);
            ts.forEachChild(node, visit);
        };
        for (const declaration of symbol.declarations ?? []) if (inScope(declaration)) visit(declaration);
    }
    return [...found].sort();
}

describe("declaration emit of a consumer", () => {
    let consumerErrors = "";

    beforeAll(() => {
        rmSync(WORK, { recursive: true, force: true });
        buildPackage();

        mkdirSync(CONSUMER, { recursive: true });
        for (const name of CONSUMERS) {
            const source = readFileSync(join(HERE, `${name}.ts`), "utf8").replace(
                /from "@\/index"/g,
                'from "@fozy-labs/rx-toolkit"',
            );
            writeFileSync(join(CONSUMER, `${name}.ts`), source);
        }
        // Its own package scope: inside the repository the package name would resolve to the repository itself.
        writeJson(join(CONSUMER, "package.json"), { name: "consumer", type: "module", private: true });
        writeJson(join(CONSUMER, "tsconfig.json"), {
            compilerOptions: {
                target: "ESNext",
                module: "ESNext",
                moduleResolution: "bundler",
                lib: ["ESNext", "DOM"],
                strict: true,
                declaration: true,
                emitDeclarationOnly: true,
                outDir: "out",
                types: [],
            },
            files: CONSUMERS.map((name) => `${name}.ts`),
        });
        try {
            run(TSC, ["-p", join(CONSUMER, "tsconfig.json")]);
        } catch (error) {
            consumerErrors = (error as Error).message;
        }
    }, 120_000);

    it("consumers compile with declarations", () => {
        expect(consumerErrors).toBe("");
    });

    it.each(CONSUMERS)("%s: refers only to the package", (name) => {
        const declaration = readFileSync(join(CONSUMER, `out/${name}.d.ts`), "utf8");
        expect(declaration).toContain("export declare const");
        expect(specifiers(declaration)).toEqual(["@fozy-labs/rx-toolkit"]);
    });

    it.each(NAMED_MODULES)("%s: every type its published declarations refer to can be named", (module) => {
        expect(unnamable(module)).toEqual([]);
    });
});
