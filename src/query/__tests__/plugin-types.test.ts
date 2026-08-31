import { assertType, describe, it } from "vitest";

import { createApi } from "@/query/api/createApi";
import { ReactHooksPlugin, reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type {
    ArgsOrVoid,
    ArgsOrVoidOrSkip,
    IPlugin,
    TCommandAgentState,
    TInfiniteResourceState,
    TResourceAgentState,
    TSuspenseResourceState,
    TTriggerPromise,
} from "@/query/types";
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

    // ---------- useSuspenseResource has correct signature ----------

    it("useSuspenseResource has signature (args: ArgsOrVoid<TArgs>) => TSuspenseResourceState<TArgs, TData>", () => {
        type TArgs = { id: number };
        type TData = { name: string };

        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource({
            queryFn: async (args: TArgs): Promise<TData> => ({ name: "Alice" }),
        });

        type HookFn = typeof resource.useSuspenseResource;
        type Param = Parameters<HookFn>[0];
        type Ret = ReturnType<HookFn>;

        // SKIP is intentionally NOT accepted (ArgsOrVoid, not ArgsOrVoidOrSkip).
        assertType<IsExact<Param, ArgsOrVoid<TArgs>>>(true as const);
        assertType<IsExact<Ret, TSuspenseResourceState<TArgs, TData>>>(true as const);

        // data is guaranteed non-null on the suspense state.
        assertType<IsExact<Ret["data"], TData>>(true as const);
    });

    it("createApi without plugins → createResource does NOT return useSuspenseResource", () => {
        const api = createApi();
        const resource = api.createResource({
            queryFn: async (args: { id: number }) => ({ name: "Alice" }),
        });

        // @ts-expect-error — useSuspenseResource should not exist without the plugin
        resource.useSuspenseResource;
    });

    // ---------- Projection resource gets the same augmentation as a resource ----------

    it("createApi with reactHooksPlugin → unstable_createProjectionResource returns useResource typed over TId[] / TItem[]", () => {
        type TUser = { id: number; name: string };

        const api = createApi({ plugins: [reactHooksPlugin()] });
        const users = api.createResource({
            queryFn: async (args: { userIds: number[] }): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: "x" })),
        });
        const projection = api.unstable_createProjectionResource({
            resource: users,
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids) => ({ userIds: ids }),
        });

        assertType<typeof projection.useResource>(projection.useResource);

        // Without parseArgs the projection args default to the id list.
        type HookFn = typeof projection.useResource;
        type Param = Parameters<HookFn>[0];
        type Ret = ReturnType<HookFn>;

        assertType<IsExact<Param, ArgsOrVoidOrSkip<number[]>>>(true as const);
        assertType<IsExact<Ret, TResourceAgentState<number[], TUser[]>>>(true as const);
    });

    it("unstable_createProjectionResource with parseArgs → useResource typed over the custom args", () => {
        type TUser = { id: number; name: string };
        type TProjectionArgs = { ids: number[]; tag?: string };

        const api = createApi({ plugins: [reactHooksPlugin()] });
        const users = api.createResource({
            queryFn: async (args: { userIds: number[] }): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: "x" })),
        });
        const projection = api.unstable_createProjectionResource({
            resource: users,
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids) => ({ userIds: ids }),
            parseArgs: (args: TProjectionArgs) => args.ids,
        });

        type HookFn = typeof projection.useResource;
        type Param = Parameters<HookFn>[0];

        assertType<IsExact<Param, ArgsOrVoidOrSkip<TProjectionArgs>>>(true as const);
    });

    it("unstable_createProjectionResource with reactHooksPlugin → useInfiniteResource typed over TArgs / TItem[]", () => {
        type TUser = { id: number; name: string };

        const api = createApi({ plugins: [reactHooksPlugin()] });
        const users = api.createResource({
            queryFn: async (args: { userIds: number[] }): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: "x" })),
        });
        const projection = api.unstable_createProjectionResource({
            resource: users,
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids) => ({ userIds: ids }),
        });

        assertType<typeof projection.useInfiniteResource>(projection.useInfiniteResource);

        type HookFn = typeof projection.useInfiniteResource;
        type Param = Parameters<HookFn>[0];
        type Ret = ReturnType<HookFn>;

        assertType<IsExact<Param, ArgsOrVoidOrSkip<number[]>>>(true as const);
        assertType<IsExact<Ret, TInfiniteResourceState<number[], TUser[]>>>(true as const);
        // Flattened data is the item array of the projection.
        assertType<IsExact<Ret["data"], TUser[] | null>>(true as const);
    });

    it("useInfiniteResource is projection-only: absent on plain resources", () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource({
            queryFn: async (args: { id: number }) => ({ name: "Alice" }),
        });

        // @ts-expect-error — useInfiniteResource exists only on projection resources
        resource.useInfiniteResource;
    });

    it("createApi without plugins → unstable_createProjectionResource does NOT return useInfiniteResource", () => {
        const api = createApi();
        const users = api.createResource({
            queryFn: async (args: { userIds: number[] }) => args.userIds.map((id) => ({ id })),
        });
        const projection = api.unstable_createProjectionResource({
            resource: users,
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids) => ({ userIds: ids }),
        });

        // @ts-expect-error — useInfiniteResource should not exist without the plugin
        projection.useInfiniteResource;
    });

    it("createApi without plugins → unstable_createProjectionResource does NOT return useResource", () => {
        const api = createApi();
        const users = api.createResource({
            queryFn: async (args: { userIds: number[] }) => args.userIds.map((id) => ({ id })),
        });
        const projection = api.unstable_createProjectionResource({
            resource: users,
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids) => ({ userIds: ids }),
        });

        // @ts-expect-error — useResource should not exist without the plugin
        projection.useResource;
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
        type ExpectedTrigger = (args: TArgs) => TTriggerPromise<TData>;
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
