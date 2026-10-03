import { assertType, describe, it } from "vitest";

import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type {
    TCommandClutchState,
    TResourceClutchState,
    TResourceEntryState,
    TSuspenseResourceState,
} from "@/query/types";

// ==================== Fixtures ====================

type IsExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

/** `Omit` applied per union member instead of to the collapsed union. */
type TDistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type TArgs = { id: number };
type TData = { name: string };
type TError = { code: number };

// The states are discriminated unions: these tests only exercise compile-time
// narrowing, so the `if` branches never need to run.

// ==================== Resource clutch state ====================

describe("state narrowing — resource clutch state, by status", () => {
    it('status === "idle" ⇒ nothing to show, no args, no error', () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.status === "idle") {
            assertType<IsExact<typeof state.dataSource, "none">>(true as const);
            assertType<IsExact<typeof state.data, null>>(true as const);
            assertType<IsExact<typeof state.dataArgs, null>>(true as const);
            assertType<IsExact<typeof state.args, null>>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);
            assertType<IsExact<typeof state.hasData, false>>(true as const);
            assertType<IsExact<typeof state.hasError, false>>(true as const);
            assertType<IsExact<typeof state.isPending, false>>(true as const);
        }
    });

    it('status === "success" ⇒ current data, no error', () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.status === "success") {
            assertType<IsExact<typeof state.dataSource, "current">>(true as const);
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataArgs, TArgs>>(true as const);
            assertType<IsExact<typeof state.args, TArgs>>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);
            assertType<IsExact<typeof state.hasData, true>>(true as const);
            assertType<IsExact<typeof state.hasError, false>>(true as const);
        }
    });

    it('status === "error" ⇒ hasError, error: TError, any dataSource (rows 7, 8, 9, 13)', () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.status === "error") {
            assertType<IsExact<typeof state.error, TError>>(true as const);
            assertType<IsExact<typeof state.hasError, true>>(true as const);
            assertType<IsExact<typeof state.dataSource, "none" | "placeholder" | "previous" | "current">>(
                true as const,
            );
            assertType<IsExact<typeof state.data, TData | null>>(true as const);
            assertType<IsExact<typeof state.isPending, false>>(true as const);
        }
    });

    it('status === "pending" ⇒ isPending, error: the retried failure or null', () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.status === "pending") {
            assertType<IsExact<typeof state.isPending, true>>(true as const);
            assertType<IsExact<typeof state.args, TArgs>>(true as const);
            // A retry in flight is `hasError` — there is no separate flag.
            assertType<IsExact<typeof state.error, TError | null>>(true as const);
            assertType<IsExact<typeof state.dataSource, "none" | "placeholder" | "previous" | "current">>(
                true as const,
            );
        }
    });
});

describe("state narrowing — resource clutch state, by dataSource", () => {
    it('dataSource === "none" ⇒ data: null, dataArgs: null, hasData: false', () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.dataSource === "none") {
            assertType<IsExact<typeof state.data, null>>(true as const);
            assertType<IsExact<typeof state.dataArgs, null>>(true as const);
            assertType<IsExact<typeof state.hasData, false>>(true as const);
            assertType<IsExact<typeof state.status, "idle" | "pending" | "error">>(true as const);
        }
    });

    it('dataSource === "placeholder" ⇒ data: TData, dataArgs: null', () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.dataSource === "placeholder") {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataArgs, null>>(true as const);
            assertType<IsExact<typeof state.hasData, true>>(true as const);
            assertType<IsExact<typeof state.status, "pending" | "error">>(true as const);
        }
    });

    it('dataSource === "previous" ⇒ data: TData, dataArgs: the previous args', () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.dataSource === "previous") {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataArgs, TArgs>>(true as const);
            assertType<IsExact<typeof state.status, "pending" | "error">>(true as const);
        }
    });

    it('dataSource === "current" ⇒ data: TData, dataArgs: the observed args', () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.dataSource === "current") {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataArgs, TArgs>>(true as const);
            assertType<IsExact<typeof state.status, "pending" | "success" | "error">>(true as const);
        }
    });
});

describe("state narrowing — resource clutch state, by flag", () => {
    it("hasData ⇒ data: TData; otherwise nothing to show", () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.hasData) {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataSource, "placeholder" | "previous" | "current">>(true as const);
        } else {
            assertType<IsExact<typeof state.data, null>>(true as const);
            assertType<IsExact<typeof state.dataSource, "none">>(true as const);
        }
    });

    it("hasError ⇒ error: TError; otherwise error: null", () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.hasError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
        } else {
            assertType<IsExact<typeof state.error, null>>(true as const);
        }
    });

    it("the three loading flags each pin a dataSource and imply isPending", () => {
        const state = {} as TResourceClutchState<TArgs, TData, TError>;

        if (state.isInitialLoading) {
            assertType<IsExact<typeof state.status, "pending">>(true as const);
            assertType<IsExact<typeof state.isPending, true>>(true as const);
            assertType<IsExact<typeof state.dataSource, "none" | "placeholder">>(true as const);
        }

        if (state.isSwitching) {
            assertType<IsExact<typeof state.status, "pending">>(true as const);
            assertType<IsExact<typeof state.dataSource, "previous">>(true as const);
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataArgs, TArgs>>(true as const);
        }

        if (state.isInvalidating) {
            assertType<IsExact<typeof state.status, "pending">>(true as const);
            assertType<IsExact<typeof state.dataSource, "current">>(true as const);
            assertType<IsExact<typeof state.data, TData>>(true as const);
        }

        if (!state.isPending) {
            assertType<IsExact<typeof state.isInitialLoading, false>>(true as const);
            assertType<IsExact<typeof state.isSwitching, false>>(true as const);
            assertType<IsExact<typeof state.isInvalidating, false>>(true as const);
        }
    });

    it("keeps the wide field types on the unnarrowed union", () => {
        type State = TResourceClutchState<TArgs, TData, TError>;

        assertType<IsExact<State["status"], "idle" | "pending" | "success" | "error">>(true as const);
        assertType<IsExact<State["dataSource"], "none" | "placeholder" | "previous" | "current">>(true as const);
        assertType<IsExact<State["error"], TError | null>>(true as const);
        assertType<IsExact<State["data"], TData | null>>(true as const);
        assertType<IsExact<State["args"], TArgs | null>>(true as const);
        assertType<IsExact<State["dataArgs"], TArgs | null>>(true as const);
        assertType<IsExact<State["hasData"], boolean>>(true as const);
        assertType<IsExact<State["hasError"], boolean>>(true as const);
        assertType<IsExact<State["isPending"], boolean>>(true as const);
        assertType<IsExact<State["isInitialLoading"], boolean>>(true as const);
        assertType<IsExact<State["isSwitching"], boolean>>(true as const);
        assertType<IsExact<State["isInvalidating"], boolean>>(true as const);
    });

    it("defaults TError to unknown", () => {
        const state = {} as TResourceClutchState<TArgs, TData>;

        if (state.hasError) {
            assertType<IsExact<typeof state.error, unknown>>(true as const);
        }
    });
});

// ==================== Resource entry state (getState) ====================

describe("state narrowing — resource entry state", () => {
    it("dataSource is narrowed to none | current and args never switch", () => {
        type State = TResourceEntryState<TArgs, TData, TError>;

        assertType<IsExact<State["dataSource"], "none" | "current">>(true as const);
        assertType<IsExact<State["status"], "idle" | "pending" | "success" | "error">>(true as const);
        assertType<IsExact<State["isSwitching"], false>>(true as const);
        assertType<IsExact<State["data"], TData | null>>(true as const);
        assertType<IsExact<State["dataArgs"], TArgs | null>>(true as const);
        assertType<IsExact<State["error"], TError | null>>(true as const);
    });

    it("narrows by status", () => {
        const state = {} as TResourceEntryState<TArgs, TData, TError>;

        if (state.status === "idle") {
            assertType<IsExact<typeof state.args, null>>(true as const);
            assertType<IsExact<typeof state.dataSource, "none">>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);
        }

        if (state.status === "success") {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataArgs, TArgs>>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);
        }

        if (state.status === "error") {
            // Row 7 has nothing to show, row 9 keeps the entry's own data.
            assertType<IsExact<typeof state.error, TError>>(true as const);
            assertType<IsExact<typeof state.data, TData | null>>(true as const);
            assertType<IsExact<typeof state.dataSource, "none" | "current">>(true as const);
        }

        if (state.status === "pending") {
            assertType<IsExact<typeof state.isPending, true>>(true as const);
            assertType<IsExact<typeof state.error, TError | null>>(true as const);
            assertType<IsExact<typeof state.args, TArgs>>(true as const);
        }
    });

    it("narrows by dataSource, hasData and hasError", () => {
        const state = {} as TResourceEntryState<TArgs, TData, TError>;

        if (state.dataSource === "current") {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataArgs, TArgs>>(true as const);
            assertType<IsExact<typeof state.status, "pending" | "success" | "error">>(true as const);
        }

        if (state.dataSource === "none") {
            assertType<IsExact<typeof state.data, null>>(true as const);
            assertType<IsExact<typeof state.status, "idle" | "pending" | "error">>(true as const);
        }

        if (state.hasData) {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.dataSource, "current">>(true as const);
        }

        if (state.hasError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
        } else {
            assertType<IsExact<typeof state.error, null>>(true as const);
        }

        if (state.isInvalidating) {
            assertType<IsExact<typeof state.status, "pending">>(true as const);
            assertType<IsExact<typeof state.dataSource, "current">>(true as const);
        }
    });

    it("is the methodless none | current subset of the clutch state", () => {
        type ClutchState = TResourceClutchState<TArgs, TData, TError>;
        type EntryState = TResourceEntryState<TArgs, TData, TError>;

        /** The clutch rows a single cache entry can reach, methods stripped. */
        type TStrippedClutchState = TDistributiveOmit<
            Extract<ClutchState, { dataSource: "none" | "current" }>,
            "retry" | "invalidate" | "refresh"
        >;

        const stripped = {} as TStrippedClutchState;
        const entry = {} as EntryState;

        // Structural equivalence, checked in both directions.
        const fromClutch: EntryState = stripped;
        const toClutch: TStrippedClutchState = entry;
        assertType<EntryState>(fromClutch);
        assertType<TStrippedClutchState>(toClutch);

        // No methods: the clutch's own members are absent from every variant.
        assertType<IsExact<Extract<keyof EntryState, "retry" | "invalidate" | "refresh">, never>>(true as const);
    });
});

// ==================== Command clutch state ====================

describe("state narrowing — command clutch state", () => {
    it("narrows data and error by status and by flag", () => {
        const state = {} as TCommandClutchState<TArgs, TData, TError>;

        if (state.status === "success") {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.error, null>>(true as const);
            assertType<IsExact<typeof state.hasData, true>>(true as const);
        }

        if (state.status === "error") {
            assertType<IsExact<typeof state.error, TError>>(true as const);
            assertType<IsExact<typeof state.data, null>>(true as const);
        }

        if (state.hasData) {
            assertType<IsExact<typeof state.data, TData>>(true as const);
            assertType<IsExact<typeof state.status, "success">>(true as const);
        }

        if (state.hasError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
            // K4 and its retry K5 — a command never holds data next to an error.
            assertType<IsExact<typeof state.status, "pending" | "error">>(true as const);
            assertType<IsExact<typeof state.data, null>>(true as const);
        }

        if (state.isPending) {
            assertType<IsExact<typeof state.status, "pending">>(true as const);
            assertType<IsExact<typeof state.data, null>>(true as const);
        }
    });
});

// ==================== Suspense state ====================

describe("state narrowing — suspense resource state", () => {
    it("data is non-null on every variant", () => {
        type State = TSuspenseResourceState<TArgs, TData, TError>;

        assertType<IsExact<State["data"], TData>>(true as const);
        assertType<IsExact<State["hasData"], true>>(true as const);
        // A placeholder carries no args of its own.
        assertType<IsExact<State["dataArgs"], TArgs | null>>(true as const);
    });

    it("hasError still narrows error to TError", () => {
        const state = {} as TSuspenseResourceState<TArgs, TData, TError>;

        if (state.hasError) {
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

        if (state.hasError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
        }
        if (state.hasData) {
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

        if (state.hasError) {
            assertType<IsExact<typeof state.error, TError>>(true as const);
            assertType<IsExact<typeof state.data, null>>(true as const);
        }
    });
});
