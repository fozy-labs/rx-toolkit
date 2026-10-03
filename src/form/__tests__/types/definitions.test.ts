/**
 * The rules the definition types enforce: schema inference, names, root-only options, disabled
 * keys, query keys, context requirements, list items, and the public node types.
 */
import { expectTypeOf } from "vitest";
import { z } from "zod";

import { SKIP } from "@/query";
import type { ReadonlySignal } from "@/signals";

import {
    FormConfigError,
    unstable_FormSignal as FormSignal,
    type FieldNode,
    type FormContext,
    type FormInit,
    type FormInput,
    type FormInstance,
    type FormNode,
    type FormOutput,
    type GroupNode,
    type ItemNode,
    type ListNode,
    type Parsed,
} from "../../index";

import { getCities, getEmailInfo, registerCommand, type NetError } from "./fixtures";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const a = f({ schema: z.string(), defaultValue: "" });
const b = f({ schema: z.string(), defaultValue: "" });

describe("schema inference", () => {
    it("keeps enum, literal and nested inputs narrow", () => {
        expectTypeOf<FormInput<ReturnType<typeof enumField>>>().toEqualTypeOf<"a" | "b">();
        expectTypeOf<FormInput<ReturnType<typeof literalField>>>().toEqualTypeOf<"fixed">();
        expectTypeOf<FormInput<ReturnType<typeof nestedField>>>().toEqualTypeOf<{ tags: ("x" | "y")[] }>();

        function enumField() {
            return f({ schema: z.enum(["a", "b"]), defaultValue: "a" });
        }
        function literalField() {
            return f({ schema: z.literal("fixed"), defaultValue: "fixed" });
        }
        function nestedField() {
            return f({ schema: z.object({ tags: z.array(z.enum(["x", "y"])) }), defaultValue: { tags: [] } });
        }
    });

    it("separates input and output", () => {
        const trimmed = f({ schema: z.string().transform((value) => value.length), defaultValue: "" });
        expectTypeOf<FormInput<typeof trimmed>>().toEqualTypeOf<string>();
        expectTypeOf<FormOutput<typeof trimmed>>().toEqualTypeOf<number>();
        expectTypeOf<FormNode<typeof trimmed>["parsed$"]>().toEqualTypeOf<ReadonlySignal<Parsed<number>>>();
    });

    it("gives unknown input for coerce schemas", () => {
        const coerced = f({ schema: z.coerce.number(), defaultValue: "12" });
        expectTypeOf<FormInput<typeof coerced>>().toBeUnknown();
        expectTypeOf<FormOutput<typeof coerced>>().toEqualTypeOf<number>();
    });

    it("rejects a wrong default and a wrong set", () => {
        // @ts-expect-error the default must be an input of the schema
        f({ schema: z.enum(["a", "b"]), defaultValue: "c" });
        const field = f({ schema: z.enum(["a", "b"]), defaultValue: "a" });
        function write(node: FormNode<typeof field>) {
            // @ts-expect-error set takes an input of the schema
            node.set("c");
        }
        void write;
    });

    it("types equals by the input", () => {
        f({
            schema: z.array(z.string()),
            defaultValue: [],
            equals: (x, y) => {
                expectTypeOf(x).toEqualTypeOf<string[]>();
                return x.length === y.length;
            },
        });
    });
});

describe("names", () => {
    it("rejects $, . and / in children, computed, queries and rule names", () => {
        // @ts-expect-error a child name must not end with $
        expect(() => g({ fields: { a$: a } })).toThrow(FormConfigError);
        // @ts-expect-error a child name must not contain .
        expect(() => g({ fields: { "a.b": a } })).toThrow(FormConfigError);
        // @ts-expect-error a computed name must not contain /
        expect(() => g({ fields: { a }, computed: { "c/d": () => 1 } })).toThrow(FormConfigError);
        // @ts-expect-error a query name must not end with $
        expect(() => g({ fields: { a }, queries: { q$: () => getCities.bind(1) } })).toThrow(FormConfigError);
        expect(() =>
            // @ts-expect-error a field query name must not contain .
            f({ schema: z.string(), defaultValue: "", queries: { "q.x": () => getCities.bind(1) } }),
        ).toThrow(FormConfigError);
        // @ts-expect-error a rule name must not end with $
        expect(() => g({ fields: { a }, validate: { rule$: () => {} } })).toThrow(FormConfigError);
    });

    it("exempts the root name and the instance key", () => {
        const root = g({ name: "sign.up/v2$", fields: { a } });
        expectTypeOf(FormSignal.state<typeof root>).toBeFunction();
        expectTypeOf<FormInit<typeof root>["key"]>().toEqualTypeOf<string | undefined>();
    });
});

describe("root-only options", () => {
    const withName = g({ name: "root", fields: { a } });
    const withSubmit = g({ fields: { a }, submit: () => Promise.resolve() });
    const withMapper = g({ fields: { a }, mapSubmitError: () => [] });
    const withPending = g({ fields: { a }, pendingQueries: "reject" });

    it("are rejected on a nested group", () => {
        // @ts-expect-error name is root-only
        expect(() => g({ fields: { withName } })).toThrow(FormConfigError);
        // @ts-expect-error submit is root-only
        expect(() => g({ fields: { withSubmit } })).toThrow(FormConfigError);
        // @ts-expect-error mapSubmitError is root-only
        expect(() => g({ fields: { withMapper } })).toThrow(FormConfigError);
        // @ts-expect-error pendingQueries is root-only
        expect(() => g({ fields: { withPending } })).toThrow(FormConfigError);
        // @ts-expect-error a list item is nested too
        expect(() => l({ item: withSubmit })).toThrow(FormConfigError);
    });

    it("do not exist on fields and lists", () => {
        // @ts-expect-error a field has no submit
        expect(() => f({ schema: z.string(), defaultValue: "", submit: () => Promise.resolve() })).toThrow(
            FormConfigError,
        );
        // @ts-expect-error a list has no name
        expect(() => l({ item: a, name: "list" })).toThrow(FormConfigError);
    });

    it("type submit, mapSubmitError and pendingQueries", () => {
        g({
            fields: { a },
            submit: () =>
                registerCommand.bind({
                    name: "",
                    email: "",
                    services: { tariff: "free", addedServices: [] },
                    phones: [],
                }),
            mapSubmitError: (error) => {
                expectTypeOf(error).toEqualTypeOf<NetError>();
                return [{ message: error.message, path: ["a"], severity: "warning", code: "net" }];
            },
        });
        g({
            fields: { a },
            submit: () => Promise.resolve(1),
            mapSubmitError: (error) => {
                expectTypeOf(error).toBeUnknown();
                return [];
            },
        });
        // @ts-expect-error submit returns a bound command or a promise
        g({ fields: { a }, submit: () => "done" });
        // @ts-expect-error mapSubmitError returns issue inputs
        g({ fields: { a }, mapSubmitError: () => ["message"] });
        // @ts-expect-error an unknown policy
        expect(() => g({ fields: { a }, pendingQueries: "skip" })).toThrow(FormConfigError);
    });

    it("type submission$ by the submit result", () => {
        const byPromise = g({ fields: { a }, submit: () => Promise.resolve(1) });
        const validationOnly = g({ fields: { a } });
        function read(first: FormInstance<typeof byPromise>, second: FormInstance<typeof validationOnly>) {
            const submission = first.submission$();
            if (submission?.status === "success") expectTypeOf(submission.data).toEqualTypeOf<number>();
            expectTypeOf(second.submission$()).toEqualTypeOf<null>();
        }
        void read;
    });
});

describe("disabled", () => {
    it("makes the listed children optional in the value, the output and SubmitCtx.parsed$", () => {
        const group = g({
            fields: { a, b },
            disabled: { b: ({ fields }) => fields.a.value$() === "" },
            submit: ({ parsed$ }) => {
                expectTypeOf(parsed$().value).toEqualTypeOf<{ a: string; b?: string }>();
                return Promise.resolve();
            },
        });
        expectTypeOf<FormInput<typeof group>>().toEqualTypeOf<{ a: string; b?: string }>();
        expectTypeOf<FormOutput<typeof group>>().toEqualTypeOf<{ a: string; b?: string }>();
        expectTypeOf<FormNode<typeof group>["fields"]["b"]["value$"]>().toEqualTypeOf<ReadonlySignal<string>>();
    });

    it("accepts only children names", () => {
        expect(() =>
            g({
                fields: { a, b },
                // @ts-expect-error not a child
                disabled: { c: () => true },
            }),
        ).toThrow(FormConfigError);
    });
});

describe("query keys", () => {
    it("accept a bound resource, falsy values and SKIP", () => {
        f({
            schema: z.string(),
            defaultValue: "",
            queries: {
                byBoolean: ({ value$ }) => value$() !== "" && getEmailInfo.bind(value$()),
                byString: ({ value$ }) => value$() && getEmailInfo.bind(value$()),
                byNull: ({ value$ }) => (value$() ? getEmailInfo.bind(value$()) : null),
                byUndefined: ({ value$ }) => (value$() ? getEmailInfo.bind(value$()) : undefined),
                bySkip: ({ value$ }) => (value$() ? getEmailInfo.bind(value$()) : SKIP),
                debounced: { bind: ({ value$ }) => getEmailInfo.bind(value$()), debounce: 300 },
            },
        });
    });

    it("infer the state of a debounced query", () => {
        const field = f({
            schema: z.string(),
            defaultValue: "",
            queries: { info: { bind: ({ value$ }) => value$() !== "" && getEmailInfo.bind(value$()), debounce: 300 } },
        });
        expectTypeOf<ReturnType<FormNode<typeof field>["queries"]["info$"]>["data"]>().toEqualTypeOf<{
            isValid: boolean;
            isCorporate: boolean;
        } | null>();
    });

    it("reject anything but a bound resource, a falsy value or SKIP", () => {
        f({
            schema: z.string(),
            defaultValue: "",
            // @ts-expect-error true is not a key
            queries: { flag: () => true },
        });
        f({
            schema: z.string(),
            defaultValue: "",
            // @ts-expect-error raw args are not a key
            queries: { args: ({ value$ }) => value$() },
        });
    });

    // The guard sees a union of bound resources. TS merges two bound resources into one when their
    // `TBoundResource` types are assignable to each other: the variance it measures for `TData`
    // lets `TBoundResource<A, X>` pass as `TBoundResource<A, Y>`. The runtime check covers that.
    it("bind one resource per key", () => {
        f({
            schema: z.string(),
            defaultValue: "",
            queries: {
                // @ts-expect-error two resources behind one key
                either: ({ value$ }) => (value$() ? getEmailInfo.bind(value$()) : getCities.bind(1)),
            },
        });
        f({
            schema: z.string(),
            defaultValue: "",
            queries: {
                either: {
                    // @ts-expect-error two resources behind one debounced key
                    bind: ({ value$ }) => (value$() ? getEmailInfo.bind(value$()) : getCities.bind(1)),
                    debounce: 100,
                },
            },
        });
    });
});

describe("context requirements", () => {
    const withId = f({
        schema: z.string(),
        defaultValue: "",
        context: FormSignal.context<{ id: string }>(),
        queries: { info: ({ context$ }) => getEmailInfo.bind(context$().id) },
    });
    const withTenant = f({ schema: z.string(), defaultValue: "", context: FormSignal.context<{ tenant: string }>() });

    it("propagate from the children to the root", () => {
        const root = g({ fields: { group: g({ fields: { withId } }), rows: l({ item: withTenant }) } });
        expectTypeOf<FormContext<typeof root>>().toEqualTypeOf<{ id: string } & { tenant: string }>();
        function create() {
            FormSignal.state(root, { context: { id: "1", tenant: "t" } });
            // @ts-expect-error the context is required
            FormSignal.state(root);
            // @ts-expect-error the context misses a key
            FormSignal.state(root, { context: { id: "1" } });
        }
        void create;
    });

    it("must satisfy the children when a group declares its own", () => {
        const root = g({ fields: { withId }, context: FormSignal.context<{ id: string; user: string }>() });
        expectTypeOf<FormContext<typeof root>>().toEqualTypeOf<{ id: string; user: string }>();
        // @ts-expect-error the declared context conflicts with the child's
        g({ fields: { withId }, context: FormSignal.context<{ id: number }>() });
        // @ts-expect-error a list's declared context must satisfy its item
        l({ item: withTenant, context: FormSignal.context<{ other: string }>() });
    });

    it("leave the context optional and unknown when nothing reads one", () => {
        const root = g({ fields: { a } });
        expectTypeOf<FormContext<typeof root>>().toBeUnknown();
        function create() {
            FormSignal.state(root);
            FormSignal.state(root, { state: { a: "" } });
        }
        void create;
        g({
            fields: { a },
            validate: ({ context$ }) => {
                expectTypeOf(context$()).toBeUnknown();
            },
        });
    });

    it("state() accepts only a group", () => {
        // @ts-expect-error a field is not a root
        expect(() => FormSignal.state(a)).toThrow();
    });
});

describe("lists", () => {
    it("take a field or a group as the item, not a list", () => {
        l({ item: a, defaultValue: ["x"] });
        l({ item: g({ fields: { a } }), defaultValue: [{ a: "x" }] });
        // @ts-expect-error a list item cannot be a list
        expect(() => l({ item: l({ item: a }) })).toThrow(FormConfigError);
        // @ts-expect-error the default is an array of item inputs
        l({ item: a, defaultValue: [1] });
    });

    it("type actions by the item", () => {
        const rows = l({ item: g({ fields: { a, b } }) });
        function act(node: FormNode<typeof rows>) {
            const row = node.push({ a: "x" });
            expectTypeOf(row.key).toEqualTypeOf<string>();
            node.insert(0, { b: "y" });
            node.remove(row);
            node.remove(row.key);
            node.move(0, 1);
            node.swap(row, 1);
            node.clear();
            expectTypeOf(node.value$()).toEqualTypeOf<{ a: string; b: string }[]>();
            expectTypeOf(node.get$("key")).toEqualTypeOf<typeof row | undefined>();
            // @ts-expect-error push takes the initial state of an item
            node.push({ c: 1 });
        }
        void act;
    });
});

describe("public node types", () => {
    const rows = l({ item: a });
    const group = g({ fields: { a, rows } });

    it("accept the nodes of definitions structurally", () => {
        function field(node: FieldNode<string>) {
            return node.value$();
        }
        function list(node: ListNode<FieldNode<string>>) {
            return node.items$();
        }
        function anyGroup(node: GroupNode) {
            return node.isValid$();
        }
        function read(node: FormNode<typeof group>) {
            field(node.fields.a);
            list(node.fields.rows);
            anyGroup(node);
            expectTypeOf(node.fields.rows.items$()[0]!).toEqualTypeOf<ItemNode<FieldNode<string, string, unknown>>>();
        }
        void read;
    });
});
