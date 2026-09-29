import { z } from "zod";

import { createApi } from "@/query";

import { getDefinitionRecord } from "./core/definition/records";
import { FormConfigError } from "./core/FormConfigError";
import { unstable_FormSignal as FormSignal } from "./FormSignal";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const api = createApi();
const getInfo = api.createResource<string, number>({ queryFn: async () => 1 });

/** Calls a builder with options the types reject, to reach the runtime checks. */
function loose<T>(builder: (options: T) => unknown, options: unknown) {
    return () => builder(options as T);
}

function configError(path: string, detail: RegExp | string) {
    return expect.objectContaining({ name: "FormConfigError", path, detail: expect.stringMatching(detail) });
}

const a = f({ schema: z.string(), defaultValue: "" });

describe("FormConfigError", () => {
    it("formats the message with the path", () => {
        const error = new FormConfigError("fields.a$", "bad name");
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("fields.a$: bad name");
        expect(new FormConfigError("", "bad options").message).toBe("bad options");
    });
});

describe("field()", () => {
    it("creates a frozen definition with normalized options", () => {
        const schema = z.string();
        const key = () => getInfo.bind("x");
        const rule = () => {};
        const definition = f({
            schema,
            defaultValue: "",
            required: true,
            showErrors: "modified",
            context: FormSignal.context<{ id: string }>(),
            queries: { plain: key, debounced: { bind: key, debounce: 300 } },
            validate: rule,
        });
        const record = getDefinitionRecord(definition);

        expect(definition.kind).toBe("field");
        expect(Object.isFrozen(definition)).toBe(true);
        expect(record).toMatchObject({
            kind: "field",
            schema,
            defaultValue: "",
            required: true,
            showErrors: "modified",
            hasContext: true,
            queries: { plain: { key, debounce: null }, debounced: { key, debounce: 300 } },
            rules: [{ name: null, fn: rule }],
        });
    });

    it("keeps the named rules in declaration order", () => {
        const first = () => {};
        const second = () => {};
        const record = getDefinitionRecord(f({ schema: z.string(), defaultValue: "", validate: { first, second } }));
        expect(record.rules).toEqual([
            { name: "first", fn: first },
            { name: "second", fn: second },
        ]);
    });

    it("rejects invalid options", () => {
        expect(loose(f, null)).toThrow(configError("", "expects an options object"));
        expect(loose(f, { defaultValue: "" })).toThrow(configError("schema", "Standard Schema"));
        expect(loose(f, { schema: z.string() })).toThrow(configError("defaultValue", "is required"));
        expect(loose(f, { schema: z.string(), defaultValue: "", schemas: 1 })).toThrow(
            configError("schemas", "not an option of field()"),
        );
        expect(loose(f, { schema: z.string(), defaultValue: "", required: "yes" })).toThrow(
            configError("required", "boolean"),
        );
        expect(loose(f, { schema: z.string(), defaultValue: "", equals: 1 })).toThrow(
            configError("equals", "function"),
        );
        expect(loose(f, { schema: z.string(), defaultValue: "", showErrors: "blur" })).toThrow(
            configError("showErrors", "touched"),
        );
        expect(loose(f, { schema: z.string(), defaultValue: "", context: {} })).toThrow(
            configError("context", "FormSignal.context"),
        );
    });

    it("accepts an undefined default", () => {
        expect(getDefinitionRecord(f({ schema: z.string().optional(), defaultValue: undefined }))).toMatchObject({
            defaultValue: undefined,
        });
    });

    it("rejects invalid queries", () => {
        const field = (queries: unknown) => loose(f, { schema: z.string(), defaultValue: "", queries });
        expect(field([])).toThrow(configError("queries", "plain object"));
        expect(field({ q: 1 })).toThrow(configError("queries.q", "a function or \\{ bind, debounce \\}"));
        expect(field({ q: { bind: () => null } })).toThrow(configError("queries.q.debounce", "non-negative"));
        expect(field({ q: { bind: () => null, debounce: -1 } })).toThrow(
            configError("queries.q.debounce", "non-negative"),
        );
        expect(field({ q: { bind: 1, debounce: 1 } })).toThrow(configError("queries.q.bind", "function"));
        expect(field({ q: { bind: () => null, debounce: 1, wait: 1 } })).toThrow(configError("queries.q", "'wait'"));
    });

    it("rejects invalid rules", () => {
        const field = (validate: unknown) => loose(f, { schema: z.string(), defaultValue: "", validate });
        expect(field("rule")).toThrow(configError("validate", "a function or a record"));
        expect(field({ rule: 1 })).toThrow(configError("validate.rule", "function"));
    });

    it.each(["name$", "a.b", "a/b"])("rejects the name %s in queries and rules", (name) => {
        const key = () => null;
        expect(loose(f, { schema: z.string(), defaultValue: "", queries: { [name]: key } })).toThrow(
            configError(`queries.${name}`, "must not end with '\\$' or contain '.' or '/'"),
        );
        expect(loose(f, { schema: z.string(), defaultValue: "", validate: { [name]: key } })).toThrow(
            configError(`validate.${name}`, "must not end with"),
        );
    });
});

describe("group()", () => {
    it("creates a frozen definition over its children", () => {
        const computedFn = () => 1;
        const disabledFn = () => false;
        const submit = () => Promise.resolve();
        const mapSubmitError = () => [];
        const definition = g({
            name: "root",
            fields: { a },
            showErrors: "always",
            computed: { c: computedFn },
            queries: { q: () => getInfo.bind("x") },
            validate: { rule: () => {} },
            disabled: { a: disabledFn },
            submit,
            mapSubmitError,
            pendingQueries: "reject",
        });
        const record = getDefinitionRecord(definition);

        expect(Object.isFrozen(definition)).toBe(true);
        expect(record).toMatchObject({
            kind: "group",
            fields: { a: getDefinitionRecord(a) },
            showErrors: "always",
            hasContext: false,
            computed: { c: computedFn },
            disabled: { a: disabledFn },
            rootOnly: true,
            name: "root",
            submit,
            mapSubmitError,
            pendingQueries: "reject",
        });
        expect(Object.isFrozen(record.kind === "group" && record.fields)).toBe(true);
    });

    it("is not root-only without root options", () => {
        expect(getDefinitionRecord(g({ fields: { a } }))).toMatchObject({ rootOnly: false, name: undefined });
    });

    it("exempts the root name from the name rules", () => {
        expect(getDefinitionRecord(g({ name: "sign.up/v2$", fields: { a } }))).toMatchObject({ name: "sign.up/v2$" });
    });

    it("rejects invalid children", () => {
        expect(loose(g, {})).toThrow(configError("fields", "plain object"));
        expect(loose(g, { fields: { a: { kind: "field" } } })).toThrow(configError("fields.a", "created by field()"));
        expect(loose(g, { fields: { a$: a } })).toThrow(configError("fields.a$", "must not end with"));
        expect(loose(g, { fields: { "a.b": a } })).toThrow(configError("fields.a.b", "must not end with"));
    });

    it.each([
        ["name", { name: "root" }],
        ["submit", { submit: () => Promise.resolve() }],
        ["mapSubmitError", { mapSubmitError: () => [] }],
        ["pendingQueries", { pendingQueries: "wait" }],
    ])("rejects a nested group with %s", (_, options) => {
        const nested = g({ fields: { a }, ...(options as object) });
        expect(loose(g, { fields: { nested } })).toThrow(configError("fields.nested", "root-only options"));
        expect(loose(l, { item: nested })).toThrow(configError("item", "root-only options"));
    });

    it("rejects invalid members", () => {
        const group = (options: object) => loose(g, { fields: { a }, ...options });
        expect(group({ computed: { c: 1 } })).toThrow(configError("computed.c", "function"));
        expect(group({ computed: { c$: () => 1 } })).toThrow(configError("computed.c$", "must not end with"));
        expect(group({ queries: { "q/x": () => null } })).toThrow(configError("queries.q/x", "must not end with"));
        expect(group({ validate: { "r.x": () => {} } })).toThrow(configError("validate.r.x", "must not end with"));
        expect(group({ disabled: { b: () => true } })).toThrow(configError("disabled.b", "not a child"));
        expect(group({ disabled: { a: true } })).toThrow(configError("disabled.a", "function"));
        expect(group({ name: 1 })).toThrow(configError("name", "string"));
        expect(group({ submit: 1 })).toThrow(configError("submit", "function"));
        expect(group({ mapSubmitError: 1 })).toThrow(configError("mapSubmitError", "function"));
        expect(group({ pendingQueries: "later" })).toThrow(configError("pendingQueries", "wait"));
        expect(group({ item: a })).toThrow(configError("item", "not an option of group()"));
    });
});

describe("list()", () => {
    it("creates a frozen definition over its item", () => {
        const definition = l({ item: a, defaultValue: ["x"], showErrors: "submitted" });
        expect(Object.isFrozen(definition)).toBe(true);
        expect(getDefinitionRecord(definition)).toMatchObject({
            kind: "list",
            item: getDefinitionRecord(a),
            defaultValue: ["x"],
            showErrors: "submitted",
            rules: [],
        });
        expect(getDefinitionRecord(l({ item: a }))).toMatchObject({ defaultValue: [] });
    });

    it("rejects invalid options", () => {
        expect(loose(l, { item: l({ item: a }) })).toThrow(configError("item", "not a list"));
        expect(loose(l, { item: {} })).toThrow(configError("item", "created by field()"));
        expect(loose(l, { item: a, defaultValue: "x" })).toThrow(configError("defaultValue", "array"));
        expect(loose(l, { item: a, validate: { r$: () => {} } })).toThrow(
            configError("validate.r$", "must not end with"),
        );
        expect(loose(l, { item: a, computed: {} })).toThrow(configError("computed", "not an option of list()"));
    });
});

describe("context() and state()", () => {
    it("creates distinct frozen context tokens", () => {
        const first = FormSignal.context<{ id: string }>();
        expect(first.kind).toBe("context");
        expect(Object.isFrozen(first)).toBe(true);
        expect(FormSignal.context()).not.toBe(first);
    });

    it("has no instance runtime yet", () => {
        expect(() => FormSignal.state(g({ fields: { a } }))).toThrow("not implemented");
    });
});
