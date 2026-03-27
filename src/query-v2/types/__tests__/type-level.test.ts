import { expectTypeOf, test } from "vitest";

import { createApi } from "@/query-v2/api/createApi";
import { ReactHooksPlugin } from "@/query-v2/plugins/ReactHooksPlugin";
import type { IReactHooksPluginContributions, IResourceV2AgentState, PluginAugmentations } from "@/query-v2/types";

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
        IResourceV2AgentState<{ id: number }, { name: string }>
    >();

    // @ts-expect-error — nonExistentMethod is not contributed by any plugin
    resource.nonExistentMethod;
});
