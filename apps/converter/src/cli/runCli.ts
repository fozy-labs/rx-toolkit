import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { convert } from "../convert.js";
import { StatechartParseError } from "../StatechartParseError.js";

export interface CliIo {
    stdout: { write(text: string): unknown };
    stderr: { write(text: string): unknown };
}

const USAGE = `Usage: statechart-convert <in.mmd> [--out <file>]

Converts a Mermaid stateDiagram-v2 file with %% @directives into a typed
statechart definition. Default output: <in>.generated.ts next to the input.

Options:
  -o, --out <file>   output file
  -h, --help         show this help
`;

type CliArgs =
    { kind: "help" } | { kind: "convert"; input: string; output: string } | { kind: "error"; message: string };

/** Default output: the input path with its extension replaced by `.generated.ts`. */
export function defaultOutputPath(input: string): string {
    const parsed = path.parse(input);
    return path.join(parsed.dir, `${parsed.name}.generated.ts`);
}

function parseCliArgs(argv: string[]): CliArgs {
    try {
        const { values, positionals } = parseArgs({
            args: argv,
            options: {
                out: { type: "string", short: "o" },
                help: { type: "boolean", short: "h" },
            },
            allowPositionals: true,
        });
        if (values.help === true) return { kind: "help" };
        if (positionals.length !== 1) return { kind: "error", message: "expected exactly one input file" };
        const input = positionals[0]!;
        return { kind: "convert", input, output: values.out ?? defaultOutputPath(input) };
    } catch (error) {
        return { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Runs the CLI; returns the exit code (0 ok, 1 conversion / io failure, 2 usage). */
export function runCli(argv: string[], io: CliIo): number {
    const args = parseCliArgs(argv);
    if (args.kind === "help") {
        io.stdout.write(USAGE);
        return 0;
    }
    if (args.kind === "error") {
        io.stderr.write(`error: ${args.message}\n${USAGE}`);
        return 2;
    }

    let text: string;
    try {
        text = readFileSync(args.input, "utf8");
    } catch (error) {
        io.stderr.write(`error: cannot read ${args.input}: ${describe(error)}\n`);
        return 1;
    }

    let code: string;
    try {
        code = convert(text, { fileName: args.input }).code;
    } catch (error) {
        if (!(error instanceof StatechartParseError)) throw error;
        io.stderr.write(`${args.input}:${error.format()}\n`);
        return 1;
    }

    try {
        writeFileSync(args.output, code, "utf8");
    } catch (error) {
        io.stderr.write(`error: cannot write ${args.output}: ${describe(error)}\n`);
        return 1;
    }
    io.stdout.write(`${args.output}\n`);
    return 0;
}
