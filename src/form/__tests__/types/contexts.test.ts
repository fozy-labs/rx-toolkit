/**
 * What each callback sees: the staged contexts, the read-only views and the declaration order.
 * Callbacks see only inputs, never verdicts.
 */
import { expectTypeOf } from "vitest";
import { z } from "zod";

import type { TResourceClutchState } from "@/query";
import type { ReadonlySignal } from "@/signals";

import { unstable_FormSignal as FormSignal, type FormInstance, type Parsed, type ParsedOk } from "../../index";

import { getCities, getEmailInfo, getTariffs, type NetError } from "./fixtures";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const a = f({ schema: z.string(), defaultValue: "" });
const count = f({ schema: z.number(), defaultValue: 0 });
const rows = l({ item: g({ fields: { a } }) });

describe("callback contexts", () => {
    it("field queries: own value$ / parsed$ and context$; no queries", () => {
        f({
            schema: z.string(),
            defaultValue: "",
            queries: {
                info: (ctx) => {
                    expectTypeOf(ctx.value$).toEqualTypeOf<ReadonlySignal<string>>();
                    expectTypeOf(ctx.parsed$).toEqualTypeOf<ReadonlySignal<Parsed<string>>>();
                    expectTypeOf(ctx.context$).toEqualTypeOf<ReadonlySignal<unknown>>();
                    // @ts-expect-error a field query does not see the queries of its field
                    void ctx.queries;
                    // @ts-expect-error a field context has no siblings
                    void ctx.fields;
                    return getEmailInfo.bind(ctx.value$());
                },
            },
        });
    });

    it("field validate: own inputs, own queries without whenSettled, collectors", () => {
        f({
            schema: z.string(),
            defaultValue: "",
            queries: { info: ({ value$ }) => getEmailInfo.bind(value$()) },
            validate: (ctx) => {
                expectTypeOf(ctx.value$()).toEqualTypeOf<string>();
                expectTypeOf(ctx.queries.info.isDebouncing$).toEqualTypeOf<ReadonlySignal<boolean>>();
                expectTypeOf(ctx.queries.info$()).toEqualTypeOf<
                    TResourceClutchState<string, { isValid: boolean; isCorporate: boolean }, NetError>
                >();
                // @ts-expect-error contexts see no whenSettled
                void ctx.queries.info.whenSettled;
                // @ts-expect-error the query state is read through queries.info$
                void ctx.queries.info.state$;
                // @ts-expect-error no verdicts
                void ctx.isValid$;
                ctx.error("message");
                ctx.warn("message", { code: "code" });
            },
        });
    });

    it("group computed: fields and own inputs; no computed, no queries", () => {
        g({
            fields: { a, count },
            computed: {
                label: (ctx) => {
                    expectTypeOf(ctx.fields.a.value$()).toEqualTypeOf<string>();
                    expectTypeOf(ctx.value$()).toEqualTypeOf<{ a: string; count: number }>();
                    expectTypeOf(ctx.parsed$()).toEqualTypeOf<Parsed<{ a: string; count: number }>>();
                    // @ts-expect-error computed does not read a sibling computed
                    void ctx.computed;
                    // @ts-expect-error computed does not read queries
                    void ctx.queries;
                    // @ts-expect-error computed does not report issues
                    void ctx.error;
                    return ctx.fields.a.value$();
                },
            },
        });
    });

    it("group queries: see computed, not the other queries", () => {
        g({
            fields: { a, count },
            computed: { doubled: ({ fields }) => fields.count.value$() * 2 },
            queries: {
                cities: (ctx) => {
                    expectTypeOf(ctx.computed.doubled$).toEqualTypeOf<ReadonlySignal<number | undefined>>();
                    // @ts-expect-error a query does not read a sibling query
                    void ctx.queries;
                    return getCities.bind(ctx.fields.count.value$());
                },
            },
        });
    });

    it("group disabled: children inputs and context$ only", () => {
        g({
            fields: { a, count },
            computed: { doubled: ({ fields }) => fields.count.value$() * 2 },
            disabled: {
                count: (ctx) => {
                    expectTypeOf(ctx.fields.a.value$()).toEqualTypeOf<string>();
                    expectTypeOf(ctx.context$).toEqualTypeOf<ReadonlySignal<unknown>>();
                    // @ts-expect-error the group's value depends on `disabled`
                    void ctx.value$;
                    // @ts-expect-error the group's parsed value depends on `disabled`
                    void ctx.parsed$;
                    // @ts-expect-error no computed in `disabled`
                    void ctx.computed;
                    return ctx.fields.a.value$() === "";
                },
            },
        });
    });

    it("group validate: fields, own inputs, computed, queries, collectors", () => {
        g({
            fields: { a, count },
            computed: { doubled: ({ fields }) => fields.count.value$() * 2 },
            queries: { cities: ({ fields }) => getCities.bind(fields.count.value$()) },
            validate: (ctx) => {
                expectTypeOf(ctx.computed.doubled$()).toEqualTypeOf<number | undefined>();
                expectTypeOf(ctx.queries.cities$()).toEqualTypeOf<TResourceClutchState<number, string[], NetError>>();
                expectTypeOf(ctx.queries.cities.isDebouncing$()).toEqualTypeOf<boolean>();
                ctx.error(ctx.fields.a, "message", { code: "code" });
                ctx.warn(ctx.fields.count, "message");
            },
        });
    });

    it("views hold inputs only: no verdicts, no aliases, no actions", () => {
        g({
            fields: { a, rows },
            validate: ({ fields }) => {
                // @ts-expect-error views have no verdicts
                void fields.a.isValid$;
                // @ts-expect-error views have no issues
                void fields.a.issues$;
                // @ts-expect-error views have no snapshot
                void fields.a.state$;
                // @ts-expect-error views have no $ aliases
                void fields.a$;
                // @ts-expect-error views have no flags
                void fields.a.isDisabled$;
                // @ts-expect-error views have no pending flag
                void fields.a.isPending$;
                // @ts-expect-error views have no actions
                fields.a.set("");
                // @ts-expect-error views have no list actions
                fields.rows.push();
                const row = fields.rows.items$()[0]!;
                expectTypeOf(row.key).toEqualTypeOf<string>();
                expectTypeOf(row.fields.a.value$()).toEqualTypeOf<string>();
                expectTypeOf(fields.rows.get$("key")).toEqualTypeOf<typeof row | undefined>();
                // @ts-expect-error list item views have no verdicts either
                void row.isValid$;
            },
        });
    });

    it("list validate: items$, own inputs, context$, collectors; no fields", () => {
        l({
            item: f({ schema: z.string(), defaultValue: "" }),
            validate: (ctx) => {
                expectTypeOf(ctx.value$()).toEqualTypeOf<string[]>();
                expectTypeOf(ctx.items$()[0]!.value$()).toEqualTypeOf<string>();
                expectTypeOf(ctx.get$("key")?.key).toEqualTypeOf<string | undefined>();
                // @ts-expect-error a list has items, not fields
                void ctx.fields;
                ctx.error(ctx.items$()[0]!, "message");
            },
        });
    });

    it("submit: narrowed parsed$, computed, queries; no collectors", () => {
        g({
            fields: { a, count },
            computed: { doubled: ({ fields }) => fields.count.value$() * 2 },
            queries: { tariffs: () => getTariffs.bind("free") },
            submit: (ctx) => {
                expectTypeOf(ctx.parsed$()).toEqualTypeOf<ParsedOk<{ a: string; count: number }>>();
                expectTypeOf(ctx.parsed$().value).toEqualTypeOf<{ a: string; count: number }>();
                expectTypeOf(ctx.computed.doubled$()).toEqualTypeOf<number | undefined>();
                expectTypeOf(ctx.queries.tariffs$().status).not.toBeAny();
                // @ts-expect-error submit reports issues through mapSubmitError
                void ctx.error;
                return Promise.resolve();
            },
        });
    });

    it("context$ is read-only", () => {
        f({
            schema: z.string(),
            defaultValue: "",
            context: FormSignal.context<{ id: string }>(),
            validate: ({ context$ }) => {
                expectTypeOf(context$()).toEqualTypeOf<{ id: string }>();
                // @ts-expect-error the context cannot be written from a callback
                context$.set({ id: "" });
            },
        });
    });
});

describe("declaration order", () => {
    it("computed → queries → validate / disabled → submit keeps every type", () => {
        const form = g({
            fields: { count },
            computed: { doubled: ({ fields }) => fields.count.value$() * 2 },
            queries: { cities: ({ computed }) => getCities.bind(computed.doubled$() ?? 0) },
            validate: ({ queries }) => void queries.cities$(),
            disabled: { count: () => false },
            submit: ({ computed, queries }) => Promise.resolve([computed.doubled$(), queries.cities$()]),
            mapSubmitError: (error) => [{ message: String(error) }],
        });
        expectTypeOf<FormInstance<typeof form>["computed"]["doubled$"]>().toEqualTypeOf<
            ReadonlySignal<number | undefined>
        >();
        expectTypeOf<ReturnType<FormInstance<typeof form>["queries"]["cities$"]>["data"]>().not.toBeAny();
    });

    it("a callback that reads computed / queries declared after it does not compile", () => {
        g({
            fields: { count },
            queries: {
                // @ts-expect-error computed is declared after queries
                cities: ({ computed }) => getCities.bind(computed.doubled$() ?? 0),
            },
            computed: { doubled: ({ fields }) => fields.count.value$() * 2 },
        });
        f({
            schema: z.string(),
            defaultValue: "",
            validate: ({ queries }) => {
                // @ts-expect-error queries are declared after validate
                void queries.info$();
            },
            queries: { info: ({ value$ }) => getEmailInfo.bind(value$()) },
        });
    });

    it("a member declared too late is dropped, so its first read does not compile", () => {
        const form = g({
            fields: { count },
            validate: ({ fields }) => void fields.count.value$(),
            queries: { cities: ({ fields }) => getCities.bind(fields.count.value$()) },
        });
        function read(instance: FormInstance<typeof form>) {
            // @ts-expect-error queries were declared after validate
            void instance.queries.cities$;
        }
        void read;
    });
});
