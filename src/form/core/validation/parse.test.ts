import type { StandardSchemaV1 } from "@/common/standard-schema";

import { FormConfigError } from "../FormConfigError";

import { ASYNC_SCHEMA_MESSAGE, parseValue } from "./parse";

function schema(validate: (value: unknown) => unknown): StandardSchemaV1 {
    return { "~standard": { version: 1, vendor: "test", validate } } as StandardSchemaV1;
}

describe("parseValue()", () => {
    const noop = () => {};

    it("a success is parsed with no issues", () => {
        expect(
            parseValue(
                schema((value) => ({ value: [value] })),
                1,
                "s",
                noop,
            ),
        ).toEqual({
            parsed: { isParsed: true, value: [1] },
            issues: [],
        });
    });

    it("issues keep the message, normalize { key } segments and take a string code", () => {
        const result = parseValue(
            schema(() => ({
                issues: [
                    { message: "A", path: [{ key: "x" }, 1, Symbol.for("s")], code: "too_small" },
                    { message: "B", code: 7 },
                ],
            })),
            "",
            "s",
            noop,
        );
        expect(result).toEqual({
            parsed: { isParsed: false, value: undefined },
            issues: [
                { message: "A", path: ["x", 1, "Symbol(s)"], code: "too_small" },
                { message: "B", path: [] },
            ],
        });
    });

    it("a throw becomes one issue", () => {
        const result = parseValue(
            schema(() => {
                throw new Error("broke");
            }),
            "",
            "s",
            noop,
        );
        expect(result.issues).toEqual([{ message: "broke", path: [] }]);
    });

    it("a malformed result becomes one issue", () => {
        expect(
            parseValue(
                schema(() => null),
                "",
                "s",
                noop,
            ).issues,
        ).toHaveLength(1);
    });

    it("a promise becomes one issue, reports once per call and swallows the rejection", async () => {
        const onAsync = vi.fn();
        const result = parseValue(
            schema(() => Promise.reject(new Error("async"))),
            "",
            "s",
            onAsync,
        );
        expect(result.issues).toEqual([{ message: ASYNC_SCHEMA_MESSAGE, path: [] }]);
        expect(onAsync).toHaveBeenCalledOnce();
        await Promise.resolve();
    });

    it("a configuration error passes through", () => {
        const run = () =>
            parseValue(
                schema(() => {
                    throw new FormConfigError("x", "bad");
                }),
                "",
                "s",
                noop,
            );
        expect(run).toThrow(FormConfigError);
    });
});
