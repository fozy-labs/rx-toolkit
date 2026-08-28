import { emit } from "./emit/emit.js";
import { parse } from "./parse/parse.js";
import { type ConvertOptions, type ConvertResult } from "./types.js";
import { validateMachineConfig } from "./validateMachineConfig.js";

/**
 * `parse` + `validateMachineConfig` + `emit`: an invalid machine fails
 * here, not at runtime. `fileName` is written into the header comment of
 * the generated file.
 */
export function convert(text: string, options: ConvertOptions): ConvertResult {
    const parsed = parse(text);
    validateMachineConfig(parsed);
    const code = emit(parsed, { fileName: options.fileName, importFrom: options.importFrom });
    return { code, parsed };
}
