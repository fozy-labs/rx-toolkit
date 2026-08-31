import { describe, it } from "vitest";

import { createApi } from "@/query/api/createApi";
import { composeHooks } from "@/query/core/api";

// ==================== composeHooks Type-Level Tests ====================

describe("composeHooks type-level tests", () => {
    // ---------- Inline composition infers TArgs/TData from the resource ----------

    it("inline composeHooks with unannotated hooks is accepted by createResource", () => {
        const api = createApi();

        api.createResource({
            queryFn: async (args: { id: number }) => args,
            onCacheEntryAdded: composeHooks(
                async (_args, _ctx) => {},
                async (_args, _ctx) => {},
            ),
        });
    });

    it("hook ctx is fully typed when queryFn's return type is annotated", () => {
        const api = createApi();

        api.createResource({
            queryFn: async (args: { id: number }): Promise<{ id: number }> => args,
            onQueryStarted: composeHooks(async (_args, ctx) => {
                const { data } = await ctx.$queryFulfilled;
                const _check: { id: number } = data;
            }, undefined),
        });
    });

    it("hook ctx is fully typed when createResource generics are explicit", () => {
        const api = createApi();

        api.createResource<{ id: number }, { id: number }>({
            queryFn: async (args) => args,
            onQueryStarted: composeHooks(async (_args, ctx) => {
                const { data } = await ctx.$queryFulfilled;
                const _check: { id: number } = data;
            }, undefined),
        });
    });

    // ---------- Known TS inference limit (documented in lifecycle.md) ----------

    it("with an inferred queryFn return type an unannotated hook ctx stays unknown", () => {
        const api = createApi();

        api.createResource({
            queryFn: async (args: { id: number }) => args,
            onQueryStarted: composeHooks(async (_args, ctx) => {
                // @ts-expect-error — ctx is unknown here: TS cannot fix TData
                // before resolving the inner composeHooks call. Annotate the
                // queryFn return type (or the hook's ctx) to get full typing.
                await ctx.$queryFulfilled;
            }, undefined),
        });
    });

    // ---------- Composition for commands ----------

    it("inline composeHooks is accepted by createCommand", () => {
        const api = createApi();

        api.createCommand({
            queryFn: async (args: { name: string }): Promise<{ ok: boolean }> => ({ ok: true }),
            onQueryStarted: composeHooks(async (_args, ctx) => {
                const { data } = await ctx.$queryFulfilled;
                const _check: { ok: boolean } = data;
            }, undefined),
        });
    });
});
