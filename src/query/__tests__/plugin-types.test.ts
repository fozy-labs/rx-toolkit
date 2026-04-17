import { assertType, describe, it } from "vitest";

import { createApi } from "@/query/api/createApi";
import { ReactHooksPlugin, reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { ArgsOrVoidOrSkip, IPlugin, TCommandAgentState, TResourceAgentState } from "@/query/types";
import type { PluginHKT } from "@/query/types/plugin-hkt";

// ==================== Helpers ====================

type IsExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

// ==================== Plugin HKT Type-Level Tests ====================

describe("Plugin HKT type-level tests", () => {
    // ---------- Resource with ReactHooksPlugin includes useResource ----------

    it("createApi with reactHooksPlugin → createResource returns useResource", () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource({
            queryFn: async (args: { id: number }) => ({ name: "Alice" }),
        });

        // useResource should exist on the augmented resource
        assertType<typeof resource.useResource>(resource.useResource);
    });

    // ---------- Resource without plugins does NOT include useResource ----------

    it("createApi without plugins → createResource does NOT return useResource", () => {
        const api = createApi();
        const resource = api.createResource({
            queryFn: async (args: { id: number }) => ({ name: "Alice" }),
        });

        // @ts-expect-error — useResource should not exist without the plugin
        resource.useResource;
    });

    // ---------- useResource has correct signature ----------

    it("useResource has correct signature (args: ArgsOrVoidOrSkip<TArgs>) => TResourceAgentState<TArgs, TData>", () => {
        type TArgs = { id: number };
        type TData = { name: string };

        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource({
            queryFn: async (args: TArgs): Promise<TData> => ({ name: "Alice" }),
        });

        // Verify parameter type
        type HookFn = typeof resource.useResource;
        type Param = Parameters<HookFn>[0];
        type Ret = ReturnType<HookFn>;

        assertType<IsExact<Param, ArgsOrVoidOrSkip<TArgs>>>(true as const);
        assertType<IsExact<Ret, TResourceAgentState<TArgs, TData>>>(true as const);
    });

    // ---------- useResource with void args ----------

    it("useResource with void args accepts void or SKIP", () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource({
            queryFn: async () => "data",
        });

        type HookFn = typeof resource.useResource;
        type Param = Parameters<HookFn>[0];

        assertType<IsExact<Param, ArgsOrVoidOrSkip<void>>>(true as const);
    });

    // ---------- Command with ReactHooksPlugin includes useCommand ----------

    it("createApi with reactHooksPlugin → createCommand returns useCommand", () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const command = api.createCommand({
            queryFn: async (args: { name: string }) => ({ id: 1 }),
        });

        // useCommand should exist on the augmented command
        assertType<typeof command.useCommand>(command.useCommand);
    });

    // ---------- Command without plugins does NOT include useCommand ----------

    it("createApi without plugins → createCommand does NOT return useCommand", () => {
        const api = createApi();
        const command = api.createCommand({
            queryFn: async (args: { name: string }) => ({ id: 1 }),
        });

        // @ts-expect-error — useCommand should not exist without the plugin
        command.useCommand;
    });

    // ---------- useCommand has correct signature ----------

    it("useCommand has correct signature (key?: string) => [trigger, state]", () => {
        type TArgs = { name: string };
        type TData = { id: number };

        const api = createApi({ plugins: [reactHooksPlugin()] });
        const command = api.createCommand({
            queryFn: async (args: TArgs): Promise<TData> => ({ id: 1 }),
        });

        type HookFn = typeof command.useCommand;
        type Param = Parameters<HookFn>[0];
        type Ret = ReturnType<HookFn>;

        // key parameter is optional string
        assertType<IsExact<Param, string | undefined>>(true as const);

        // Return type is [trigger, state] tuple
        type ExpectedTrigger = (args: TArgs) => Promise<TData>;
        type ExpectedState = TCommandAgentState<TArgs, TData>;
        type ExpectedReturn = [trigger: ExpectedTrigger, state: ExpectedState];

        assertType<IsExact<Ret, ExpectedReturn>>(true as const);
    });

    // ---------- Multiple plugins → augmentations from all are available ----------

    it("multiple plugins → augmentations from all plugins are available", () => {
        // Define a second fake plugin HKT
        interface FakeLoggerHKT extends PluginHKT {
            readonly resourceType: { logAccess: () => void };
            readonly commandType: { logExecution: () => void };
        }

        class FakeLoggerPlugin implements IPlugin {
            readonly name = "FakeLoggerPlugin";
            declare readonly _hkt: FakeLoggerHKT;
            install(): void {
                // no-op
            }
        }

        const api = createApi({
            plugins: [reactHooksPlugin(), new FakeLoggerPlugin()],
        });

        const resource = api.createResource({
            queryFn: async () => "data",
        });

        // Both plugin augmentations should be present on resource
        assertType<typeof resource.useResource>(resource.useResource);
        assertType<typeof resource.logAccess>(resource.logAccess);

        const command = api.createCommand({
            queryFn: async () => "ok",
        });

        // Both plugin augmentations should be present on command
        assertType<typeof command.useCommand>(command.useCommand);
        assertType<typeof command.logExecution>(command.logExecution);
    });

    // ---------- Empty plugins array → no augmentation ----------

    it("empty plugins array → no augmentation", () => {
        const api = createApi({ plugins: [] as const });
        const resource = api.createResource({
            queryFn: async (args: number) => "data",
        });

        // @ts-expect-error — useResource should not exist with empty plugins
        resource.useResource;
    });
});
