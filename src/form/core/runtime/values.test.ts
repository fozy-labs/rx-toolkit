import { ABSENT, childData, composedParsedEquals, DEFAULTS, isProvided, parsedEquals, safeEquals } from "./values";

describe("isProvided()", () => {
    it("an own key with a value other than undefined; null is a value", () => {
        expect(isProvided({ a: 1 }, "a")).toBe(true);
        expect(isProvided({ a: null }, "a")).toBe(true);
        expect(isProvided({ a: undefined }, "a")).toBe(false);
        expect(isProvided({}, "a")).toBe(false);
        expect(isProvided(Object.create({ a: 1 }), "a")).toBe(false);
        expect(isProvided(null, "a")).toBe(false);
        expect(isProvided("a", "length")).toBe(false);
    });
});

describe("childData()", () => {
    it("passes DEFAULTS down and marks a missing key ABSENT", () => {
        expect(childData(DEFAULTS, "a")).toBe(DEFAULTS);
        expect(childData({ a: 1 }, "a")).toBe(1);
        expect(childData({ a: undefined }, "a")).toBe(ABSENT);
        expect(childData(ABSENT, "a")).toBe(ABSENT);
    });
});

describe("safeEquals()", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("uses Object.is without equals", () => {
        expect(safeEquals(undefined, NaN, NaN, "a")).toBe(true);
        expect(safeEquals(undefined, [], [], "a")).toBe(false);
    });

    it("falls back to Object.is and logs when equals throws", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const equals = () => {
            throw new Error("boom");
        };
        expect(safeEquals(equals, 1, 1, "a.b")).toBe(true);
        expect(safeEquals(equals, 1, 2, "a.b")).toBe(false);
        expect(consoleError).toHaveBeenCalledTimes(2);
        expect(String(consoleError.mock.calls[0][0])).toContain('"a.b"');
    });
});

describe("parsed equality", () => {
    it("a field compares isParsed and the value by identity", () => {
        const value = {};
        expect(parsedEquals({ isParsed: true, value }, { isParsed: true, value })).toBe(true);
        expect(parsedEquals({ isParsed: true, value: {} }, { isParsed: true, value: {} })).toBe(false);
        expect(parsedEquals({ isParsed: false, value: undefined }, { isParsed: true, value: undefined })).toBe(false);
    });

    it("a group compares isParsed and every key by identity", () => {
        expect(composedParsedEquals({ isParsed: true, value: { a: 1 } }, { isParsed: true, value: { a: 1 } })).toBe(
            true,
        );
        expect(composedParsedEquals({ isParsed: true, value: { a: [] } }, { isParsed: true, value: { a: [] } })).toBe(
            false,
        );
    });
});
