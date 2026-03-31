import { expectTypeOf } from "vitest";

import { createApi } from "@/query/api/createApi";
import { ReactHooksPlugin } from "@/query/plugins/ReactHooksPlugin";
import type { IReactHooksPluginContributions, PluginAugmentations, TResourceAgentState } from "@/query/types";

describe("type-level: PluginAugmentations", () => {
    // PL09: PluginAugmentations resolves correct contribution types at compile time
    it("PL09: resolves correct contribution types at compile time", () => {
        type Result = PluginAugmentations<readonly [ReactHooksPlugin], { id: number }, { name: string }>;

        expectTypeOf<Result>().toMatchTypeOf<IReactHooksPluginContributions<{ id: number }, { name: string }>>();

        type HookReturn = ReturnType<Result["useResourceAgent"]>;
        expectTypeOf<HookReturn>().toMatchTypeOf<TResourceAgentState<{ id: number }, { name: string }>>();
    });

    // PL10: PluginAugmentations rejects invalid plugin access at compile time
    it("PL10: accessing undeclared contribution is a compile error", () => {
        const api = createApi({
            plugins: [new ReactHooksPlugin()] as const,
        });

        const resource = api.createResource<void, string>({
            queryFn: () => Promise.resolve("data"),
            cacheLifetime: false as never,
        });

        // Valid: useResourceAgent should exist
        expectTypeOf(resource.useResourceAgent).toBeFunction();

        // @ts-expect-error — nonExistentMethod does not exist on augmented resource
        resource.nonExistentMethod;
    });
});
