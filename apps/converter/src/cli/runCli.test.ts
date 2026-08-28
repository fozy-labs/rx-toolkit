import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { convert } from "../convert.js";

import { defaultOutputPath, runCli } from "./runCli.js";

const VALID = "stateDiagram-v2\n%% @machine m\n[*] --> a\na --> b: X\n";

interface Capture {
    io: { stdout: { write(text: string): void }; stderr: { write(text: string): void } };
    stdout(): string;
    stderr(): string;
}

function capture(): Capture {
    const out: string[] = [];
    const err: string[] = [];
    return {
        io: {
            stdout: { write: (text: string) => void out.push(text) },
            stderr: { write: (text: string) => void err.push(text) },
        },
        stdout: () => out.join(""),
        stderr: () => err.join(""),
    };
}

describe("defaultOutputPath", () => {
    it("replaces the extension with .generated.ts next to the input", () => {
        expect(defaultOutputPath(path.join("dir", "x.mmd"))).toBe(path.join("dir", "x.generated.ts"));
        expect(defaultOutputPath("x")).toBe("x.generated.ts");
        expect(defaultOutputPath("a.b.mmd")).toBe("a.b.generated.ts");
    });
});

describe("runCli", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(path.join(os.tmpdir(), "sc-cli-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("writes <name>.generated.ts next to the input and prints its path", () => {
        const input = path.join(dir, "m.mmd");
        writeFileSync(input, VALID, "utf8");
        const { io, stdout, stderr } = capture();
        expect(runCli([input], io)).toBe(0);
        const output = path.join(dir, "m.generated.ts");
        expect(stdout()).toBe(`${output}\n`);
        expect(stderr()).toBe("");
        expect(readFileSync(output, "utf8")).toBe(convert(VALID, { fileName: input }).code);
    });

    it("honours --out and -o", () => {
        const input = path.join(dir, "m.mmd");
        writeFileSync(input, VALID, "utf8");
        const long = path.join(dir, "long.ts");
        const short = path.join(dir, "short.ts");
        expect(runCli([input, "--out", long], capture().io)).toBe(0);
        expect(runCli(["-o", short, input], capture().io)).toBe(0);
        expect(readFileSync(long, "utf8")).toBe(readFileSync(short, "utf8"));
    });

    it("prints the usage on --help / -h", () => {
        for (const flag of ["--help", "-h"]) {
            const { io, stdout, stderr } = capture();
            expect(runCli([flag], io)).toBe(0);
            expect(stdout()).toContain("Usage: statechart-convert <in.mmd> [--out <file>]");
            expect(stderr()).toBe("");
        }
    });

    it("returns 2 with the usage on stderr for bad arguments", () => {
        const input = path.join(dir, "m.mmd");
        writeFileSync(input, VALID, "utf8");
        for (const argv of [[], [input, input], [input, "--bogus"]]) {
            const { io, stdout, stderr } = capture();
            expect(runCli(argv, io)).toBe(2);
            expect(stdout()).toBe("");
            expect(stderr()).toMatch(/^error: /);
            expect(stderr()).toContain("Usage: statechart-convert");
        }
    });

    it("returns 1 when the input cannot be read", () => {
        const missing = path.join(dir, "missing.mmd");
        const { io, stderr } = capture();
        expect(runCli([missing], io)).toBe(1);
        expect(stderr()).toContain(`error: cannot read ${missing}`);
    });

    it("returns 1 and prints file:line:column: message for a conversion error", () => {
        const input = path.join(dir, "bad.mmd");
        writeFileSync(input, "stateDiagram-v2\n%% @machine m\n[*] --> a\na --> b: X / f; g\n", "utf8");
        const { io, stdout, stderr } = capture();
        expect(runCli([input], io)).toBe(1);
        expect(stdout()).toBe("");
        expect(stderr()).toBe(
            `${input}:4:15: \`;\` is not allowed: mermaid reads it as a statement separator (one statement per line)\n`,
        );
    });

    it("prints file:line: message for errors without a column (root scope: no path suffix)", () => {
        const input = path.join(dir, "bad.mmd");
        writeFileSync(input, "stateDiagram-v2\n%% @machine m\na --> b: X\n", "utf8");
        const { io, stderr } = capture();
        expect(runCli([input], io)).toBe(1);
        expect(stderr()).toBe(`${input}:1: the root of the diagram has no initial state: add \`[*] --> <state>\`\n`);
    });

    it("prints the path suffix for errors inside a block", () => {
        const input = path.join(dir, "bad.mmd");
        writeFileSync(input, "stateDiagram-v2\n%% @machine m\n[*] --> a\nstate a {\n    x --> y: E\n}\n", "utf8");
        const { io, stderr } = capture();
        expect(runCli([input], io)).toBe(1);
        expect(stderr()).toBe(`${input}:4: state \`a\` has no initial state: add \`[*] --> <state>\` (at a)\n`);
    });
});
