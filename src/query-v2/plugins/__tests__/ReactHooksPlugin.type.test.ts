import { expectTypeOf } from "vitest";

import { createApi } from "@/query-v2/api/createApi";
import { ReactHooksPlugin } from "@/query-v2/plugins/ReactHooksPlugin";
import type { IReactHooksPluginContributions, PluginAugmentations, TResourceV2AgentState } from "@/query-v2/types";

describe("type-level: PluginAugmentations", () => {
    // PL09: PluginAugmentations resolves correct contribution types at compile time
    it("PL09: resolves correct contribution types at compile time", () => {
        type Result = PluginAugmentations<readonly [ReactHooksPlugin], { id: number }, { name: string }>;

        expectTypeOf<Result>().toMatchTypeOf<IReactHooksPluginContributions<{ id: number }, { name: string }>>();

        type HookReturn = ReturnType<Result["useResourceV2Agent"]>;
        expectTypeOf<HookReturn>().toMatchTypeOf<TResourceV2AgentState<{ id: number }, { name: string }>>();
    });

    // PL10: PluginAugmentations rejects invalid plugin access at compile time
    it("PL10: accessing undeclared contribution is a compile error", () => {
        const api = createApi({
            plugins: [new ReactHooksPlugin()] as const,
        });

        const resource = api.createResourceV2<void, string>({
            queryFn: () => Promise.resolve("data"),
            cacheLifetime: false as never,
        });

        // Valid: useResourceV2Agent should exist
        expectTypeOf(resource.useResourceV2Agent).toBeFunction();

        // @ts-expect-error — nonExistentMethod does not exist on augmented resource
        resource.nonExistentMethod;
    });
});
