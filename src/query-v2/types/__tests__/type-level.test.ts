import { expectTypeOf, test } from "vitest";

import { createApi } from "@/query-v2/api/createApi";
import { ReactHooksPlugin } from "@/query-v2/plugins/ReactHooksPlugin";
import type {
    IReactHooksPluginContributions,
    PluginAugmentations,
    TErrorState,
    TPendingState,
    TResourceV2AgentState,
    TSuccessState,
} from "@/query-v2/types";

// PL09: PluginAugmentations<[ReactHooksPlugin], TArgs, TData> resolves to
// IReactHooksPluginContributions<TArgs, TData> at compile time
test("PL09: PluginAugmentations resolves correct contribution types", () => {
    type Result = PluginAugmentations<[ReactHooksPlugin], { id: number }, { name: string }>;

    expectTypeOf<Result>().toEqualTypeOf<IReactHooksPluginContributions<{ id: number }, { name: string }>>();
});

// PL10: PluginAugmentations rejects invalid plugin access at compile time
test("PL10: augmented resource does not expose non-existent methods", () => {
    const plugin = new ReactHooksPlugin();
    const api = createApi({ plugins: [plugin] as const });
    const resource = api.createResourceV2<{ id: number }, { name: string }>({
        queryFn: () => Promise.resolve({ name: "test" }),
        cacheLifetime: false as never,
    });

    // useResourceV2Agent is contributed by ReactHooksPlugin
    expectTypeOf(resource.useResourceV2Agent).toBeFunction();
    // Type-only assertion — do not invoke the hook at runtime (no React context)
    expectTypeOf(resource.useResourceV2Agent).returns.toEqualTypeOf<
        TResourceV2AgentState<{ id: number }, { name: string }>
    >();

    // @ts-expect-error — nonExistentMethod is not contributed by any plugin
    resource.nonExistentMethod;
});

// T06-TL: lastError present on TSuccessState, absent on TPendingState and TErrorState
test("lastError is present on TSuccessState and absent on TPendingState/TErrorState", () => {
    type Success = TSuccessState<{ id: number }, { name: string }>;
    type Pending = TPendingState<{ id: number }>;
    type ErrorSt = TErrorState<{ id: number }>;

    // lastError is an optional property on TSuccessState
    expectTypeOf<Success["lastError"]>().toEqualTypeOf<unknown | undefined>();

    // TPendingState should NOT have lastError
    expectTypeOf<Pending>().not.toHaveProperty("lastError");

    // TErrorState should NOT have lastError
    expectTypeOf<ErrorSt>().not.toHaveProperty("lastError");
});
