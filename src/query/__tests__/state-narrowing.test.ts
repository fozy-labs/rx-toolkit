import { assertType, describe, it } from "vitest";

import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type {
    IResourceLiteState,
    TCommandAgentState,
    TResourceAgentState,
    TSuspenseResourceState,
} from "@/query/types";

// ==================== Fixtures ====================

type IsExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

type TArgs = { id: number };
type TData = { name: string };
type TError = { code: number };

// The states are discriminated unions: these tests only exercise compile-time
// narrowing, so the `if` branches never need to run.

// ==================== Resource agent state ====================

describe("state narrowing — resource agent state", () => {
    it("isSuccess ⇒ data: TData, error: null", () => {
        const state = {} as TResourceAgentState<TArgs, TData, TError>;

        if (state.isSuccess) {
            assertType<IsExact<typeof state.status, "success">>(true as const);
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);
        }
    });

    it("isError ⇒ error: TError (error | refresh-error)", () => {
        const state = {} as TResourceAgentState<TArgs, TData, TError>;

        if (state.isError) {
            assertType<IsExact<typeof state.status, "error" | "refresh-error">>(true as const);
            assertType<IsExact<typeof state.error, TError>>(true as const);

            // refresh-error additionally guarantees stale data.
            if (state.isRefreshError) {
                assertType<IsExact<typeof state.data, TData>>(true as const);
            }
        }
    });

    it("isLoading ⇒ pending | refreshing, error: null", () => {
        const state = {} as TResourceAgentState<TArgs, TData, TError>;

        if (state.isLoading) {
            assertType<IsExact<typeof state.status, "pending" | "refreshing">>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);

            if (state.isRefreshing) {
                assertType<IsExact<typeof state.data, TData>>(true as const);
            }
        }
    });

    it('status === "idle" ⇒ args: null; otherwise args: TArgs', () => {
        const state = {} as TResourceAgentState<TArgs, TData, TError>;

        if (state.status === "idle") {
            assertType<IsExact<typeof state.args, null>>(true as const);
        } else {
            assertType<IsExact<typeof state.args, TArgs>>(true as const);
        }
    });

    it("keeps the wide field types on the unnarrowed union", () => {
        type State = TResourceAgentState<TArgs, TData, TError>;

        assertType<IsExact<State["error"], TError | null>>(true as const);
        assertType<IsExact<State["data"], TData | null>>(true as const);
        assertType<IsExact<State["args"], TArgs | null>>(true as const);
    });

    it("defaults TError to unknown", () => {
        const state = {} as TResourceAgentState<TArgs, TData>;

        if (state.isError) {
            assertType<IsExact<typeof state.error, unknown>>(true as const);
        }
    });
});

// ==================== Resource lite state (getState) ====================

describe("state narrowing — resource lite state", () => {
    it("narrows data / error per status; the error variant has no stale data", () => {
        const state = {} as IResourceLiteState<TArgs, TData, TError>;

        if (state.isSuccess) {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);
        }

        if (state.status === "error") {
            assertType<IsExact<typeof state.data, null>>(true as const);
            assertType<IsExact<typeof state.error, TError>>(true as const);
        }

        if (state.isRefreshError) {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.error, TError>>(true as const);
        }
    });
});

// ==================== Command agent state ====================

describe("state narrowing — command agent state", () => {
    it("isSuccess ⇒ data: TData; isError ⇒ error: TError, data: null", () => {
        const state = {} as TCommandAgentState<TArgs, TData, TError>;

        if (state.isSuccess) {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);
        }

        if (state.isError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
            assertType<IsExact<typeof state.data, null>>(true as const);
        }
    });
});

// ==================== Suspense state ====================

describe("state narrowing — suspense resource state", () => {
    it("data is non-null on every variant", () => {
        type State = TSuspenseResourceState<TArgs, TData, TError>;

        assertType<IsExact<State["data"], TData>>(true as const);
    });

    it("isError still narrows error to TError", () => {
        const state = {} as TSuspenseResourceState<TArgs, TData, TError>;

        if (state.isError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
            assertType<IsExact<typeof state.data, TData>>(true as const);
        }
    });
});

// ==================== End-to-end through createApi + plugin ====================

describe("state narrowing — through the React hooks plugin", () => {
    it("narrows the useResource return with TError inferred from mapError", () => {
        const api = createApi({
            plugins: [reactHooksPlugin()],
            mapError: (): TError => ({ code: 500 }),
        });
        const resource = api.createResource({
            queryFn: async (_args: TArgs): Promise<TData> => ({ name: "Alice" }),
        });

        const state = {} as ReturnType<typeof resource.useResource>;

        if (state.isError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
        }
        if (state.isSuccess) {
            assertType<IsExact<typeof state.data, TData>>(true as const);
        }
    });

    it("narrows the useCommand state with TError inferred from mapError", () => {
        const api = createApi({
            plugins: [reactHooksPlugin()],
            mapError: (): TError => ({ code: 500 }),
        });
        const command = api.createCommand({
            queryFn: async (_args: TArgs): Promise<TData> => ({ name: "Alice" }),
        });

        // Derive the types without invoking the hook (it is not inside a component).
        const state = {} as ReturnType<typeof command.useCommand>[1];

        if (state.isError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
            assertType<IsExact<typeof state.data, null>>(true as const);
        }
    });
});
