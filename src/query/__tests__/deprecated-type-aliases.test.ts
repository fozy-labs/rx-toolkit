import { describe, expect, expectTypeOf, it } from "vitest";

import { composeHooks } from "@/query";
import type * as Query from "@/query";
import type {
    Args,
    ArgsOrVoid,
    ArgsOrVoidOrSkip,
    CombinePluginCommandAugments,
    CombinePluginProjectionResourceAugments,
    CombinePluginResourceAugments,
    ICommandAgent,
    ICommandClutch,
    IPlugin,
    IPluginHKT,
    IResourceAgent,
    IResourceClutch,
    Keyed,
    PluginHKT,
    TAgentStatus,
    TArgsOrKeyed,
    TArgsOrVoid,
    TArgsOrVoidOrSkip,
    TBound,
    TBoundCommand,
    TBoundResource,
    TClutchStatus,
    TCombinePluginCommandAugments,
    TCombinePluginProjectionResourceAugments,
    TCombinePluginResourceAugments,
    TErrorState,
    TKeyed,
    TMachineState,
    TMachineStatus,
    TPacked,
    TPackedCommand,
    TPackedResource,
    TPendingState,
    TQueryEntryErrorState,
    TQueryEntryPendingState,
    TQueryEntryState,
    TQueryEntryStatus,
    TQueryEntrySuccessState,
    TSuccessState,
} from "@/query";
import type { IReactHooksPluginHKT, ReactHooksPluginHKT } from "@/react";

/**
 * The 0.13.0 renames keep a deprecated alias for one release (removed in
 * 0.14.0). Type aliases cannot be asserted at runtime, so this file pins them
 * with `expectTypeOf`: every alias must resolve to exactly the new type.
 *
 * The derived state types (resource / command clutch, `getState`) intentionally
 * have no aliases — their shape changed, so a silent alias would be a lie. The
 * raw cache-entry record only changed its name and lost its class wrapper, so it
 * keeps aliases like any other pure rename.
 */
describe("deprecated type aliases (removed in 0.14.0)", () => {
    it("common type prefixes forward to the T-prefixed names", () => {
        expectTypeOf<Keyed<number>>().toEqualTypeOf<TKeyed<number>>();
        expectTypeOf<Args<number>>().toEqualTypeOf<TArgsOrKeyed<number>>();
        expectTypeOf<ArgsOrVoid<number>>().toEqualTypeOf<TArgsOrVoid<number>>();
        expectTypeOf<ArgsOrVoid<void>>().toEqualTypeOf<TArgsOrVoid<void>>();
        expectTypeOf<ArgsOrVoidOrSkip<number>>().toEqualTypeOf<TArgsOrVoidOrSkip<number>>();
        expectTypeOf<ArgsOrVoidOrSkip<void>>().toEqualTypeOf<TArgsOrVoidOrSkip<void>>();
    });

    it("TAgentStatus forwards to TClutchStatus", () => {
        expectTypeOf<TAgentStatus>().toEqualTypeOf<TClutchStatus>();
    });

    it("query entry state types forward from the Machine names", () => {
        expectTypeOf<TMachineState<number, string>>().toEqualTypeOf<TQueryEntryState<number, string>>();
        expectTypeOf<TMachineStatus>().toEqualTypeOf<TQueryEntryStatus>();
        expectTypeOf<TPendingState<number>>().toEqualTypeOf<TQueryEntryPendingState<number>>();
        expectTypeOf<TSuccessState<number, string>>().toEqualTypeOf<TQueryEntrySuccessState<number, string>>();
        expectTypeOf<TErrorState<number>>().toEqualTypeOf<TQueryEntryErrorState<number>>();
    });

    it("names no release had get no alias", () => {
        // Intermediate 0.13.0 names: 0.12 had TRefreshingState / TRefreshErrorState.
        // @ts-expect-error — never released
        expectTypeOf<Query.TInvalidatingState<number, string>>().not.toBeNever();
        // @ts-expect-error — never released
        expectTypeOf<Query.TInvalidateErrorState<number, string>>().not.toBeNever();
    });

    it("clutch interfaces forward from the Agent names", () => {
        expectTypeOf<IResourceAgent<number, string>>().toEqualTypeOf<IResourceClutch<number, string>>();
        expectTypeOf<ICommandAgent<number, string>>().toEqualTypeOf<ICommandClutch<number, string>>();
    });

    it("bound descriptors forward from the Packed names", () => {
        expectTypeOf<TPackedResource<number, string>>().toEqualTypeOf<TBoundResource<number, string>>();
        expectTypeOf<TPackedCommand<number, string>>().toEqualTypeOf<TBoundCommand<number, string>>();
        expectTypeOf<TPacked<number, string>>().toEqualTypeOf<TBound<number, string>>();
    });

    it("plugin HKT names forward to the prefixed ones", () => {
        expectTypeOf<PluginHKT>().toEqualTypeOf<IPluginHKT>();
        expectTypeOf<ReactHooksPluginHKT>().toEqualTypeOf<IReactHooksPluginHKT>();
        expectTypeOf<CombinePluginResourceAugments<readonly IPlugin[], number, string>>().toEqualTypeOf<
            TCombinePluginResourceAugments<readonly IPlugin[], number, string>
        >();
        expectTypeOf<CombinePluginCommandAugments<readonly IPlugin[], number, string>>().toEqualTypeOf<
            TCombinePluginCommandAugments<readonly IPlugin[], number, string>
        >();
        expectTypeOf<CombinePluginProjectionResourceAugments<readonly IPlugin[], number, string>>().toEqualTypeOf<
            TCombinePluginProjectionResourceAugments<readonly IPlugin[], number, string>
        >();
    });

    it("composeHooks is still exported and still composes", async () => {
        const calls: string[] = [];
        const composed = composeHooks<number, { tag: string }>(
            (args, ctx) => {
                calls.push(`a:${args}:${ctx.tag}`);
            },
            undefined,
            (args) => {
                calls.push(`b:${args}`);
            },
        );

        expect(composed).toBeTypeOf("function");
        await composed!(1, { tag: "x" });
        expect(calls).toEqual(["a:1:x", "b:1"]);
    });
});
