// @vitest-environment node
/// <reference types="node" />
/**
 * Declaration emit of consumers: every consumer module next to this file compiles with
 * `declaration: true` against the package as it is published — the declarations of `src` built
 * by `tsc` and `tsc-alias` into a `node_modules/@fozy-labs/rx-toolkit` — with no error (TS2742,
 * TS4023, TS4058: a type the declaration cannot name), and its declaration refers to no module
 * but `@fozy-labs/rx-toolkit`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const WORK = join(ROOT, ".tmp/declarations");
const PACKAGE = join(WORK, "node_modules/@fozy-labs/rx-toolkit");
const CONSUMER = join(WORK, "consumer");
const CONSUMERS = ["form", "query"];
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

describe("declaration emit of a consumer", () => {
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
        run(TSC, ["-p", join(CONSUMER, "tsconfig.json")]);
    }, 120_000);

    it.each(CONSUMERS)("%s: refers only to the package", (name) => {
        const declaration = readFileSync(join(CONSUMER, `out/${name}.d.ts`), "utf8");
        expect(declaration).toContain("export declare const");
        expect(specifiers(declaration)).toEqual(["@fozy-labs/rx-toolkit"]);
    });
});
