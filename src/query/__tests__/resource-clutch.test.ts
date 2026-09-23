import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { SKIP } from "@/query/constants";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IResourceClutch, IResourceConfig, TResourceClutchState } from "@/query/types";
import { Signal } from "@/signals/signals/Signal";

// ==================== Matrix ====================
//
// The fourteen rows of the state matrix (docs/query/api/resource-clutch.md).
// `status` and `dataSource` identify a row; every flag is derived from them by
// the spec's formula table, and `hasError` by `error !== null`.

const MATRIX = {
    1: { status: "idle", dataSource: "none" },
    2: { status: "pending", dataSource: "none" },
    3: { status: "pending", dataSource: "placeholder" },
    4: { status: "pending", dataSource: "previous" },
    5: { status: "success", dataSource: "current" },
    6: { status: "pending", dataSource: "current" },
    7: { status: "error", dataSource: "none" },
    8: { status: "error", dataSource: "previous" },
    9: { status: "error", dataSource: "current" },
    10: { status: "pending", dataSource: "none" },
    11: { status: "pending", dataSource: "previous" },
    12: { status: "pending", dataSource: "current" },
    13: { status: "error", dataSource: "placeholder" },
    14: { status: "pending", dataSource: "placeholder" },
} as const;

type TRow = keyof typeof MATRIX;

/** Rows whose `hasError` column is ✓ in the matrix. */
const ROWS_WITH_ERROR: TRow[] = [7, 8, 9, 10, 11, 12, 13, 14];

/**
 * Assert the full state shape against a matrix row: the six data fields plus
 * all six flags, the flags recomputed from the row per the formula table.
 */
function expectRow(
    state: TResourceClutchState<number, string>,
    row: TRow,
    fields: { args?: number | null; data?: string | null; dataArgs?: number | null; error?: unknown } = {},
): void {
    const { status, dataSource } = MATRIX[row];
    const error = fields.error ?? null;

    // The row number and the error slot must agree with the matrix.
    expect(ROWS_WITH_ERROR.includes(row)).toBe(error !== null);
    // Identity, so a wrapped/copied failure fails the assertion.
    expect(state.error).toBe(error);

    expect({
        status: state.status,
        dataSource: state.dataSource,
        data: state.data,
        dataArgs: state.dataArgs,
        args: state.args,
        isPending: state.isPending,
        isInitialLoading: state.isInitialLoading,
        isSwitching: state.isSwitching,
        isInvalidating: state.isInvalidating,
        hasData: state.hasData,
        hasError: state.hasError,
    }).toEqual({
        status,
        dataSource,
        data: fields.data ?? null,
        dataArgs: fields.dataArgs ?? null,
        args: fields.args ?? null,
        isPending: status === "pending",
        isInitialLoading: status === "pending" && (dataSource === "none" || dataSource === "placeholder"),
        isSwitching: status === "pending" && dataSource === "previous",
        isInvalidating: status === "pending" && dataSource === "current",
        hasData: dataSource !== "none",
        hasError: error !== null,
    });
}

// ==================== Harness ====================

type TPlaceholderImpl = NonNullable<IResourceConfig<number, string>["placeholderData"]>;

const FAIL_1 = new Error("fail-1");
const FAIL_2 = new Error("fail-2");

/** "Placeholder outranks previous": always synthesizes data for the new args. */
const ALWAYS_PLACEHOLDER: TPlaceholderImpl = (args) => ({ data: `ph-${args}` });
/** The behaviour of a resource without the option. */
const NO_PLACEHOLDER: TPlaceholderImpl = () => null;

const _effects: Array<{ unsubscribe: () => void }> = [];

function observe(clutch: IResourceClutch<number, string>): () => TResourceClutchState<number, string> {
    let latest!: TResourceClutchState<number, string>;
    const eff = Signal.effect(() => {
        latest = clutch.state$();
    });
    _effects.push(eff);
    return () => latest;
}

interface Harness {
    resource: Resource<number, string>;
    clutch: IResourceClutch<number, string>;
    /** Latest derived state, collected through a live effect. */
    state: () => TResourceClutchState<number, string>;
    placeholder: Mock<TPlaceholderImpl>;
    /** Swap the `placeholderData` implementation between steps of a scenario. */
    setPlaceholder: (impl: TPlaceholderImpl) => void;
    /** Number of query runs started so far. */
    runs: () => number;
    /** Settle the oldest in-flight run with data. */
    ok: (value: string) => Promise<void>;
    /** Settle the oldest in-flight run with a failure. */
    fail: (error: unknown) => Promise<void>;
}

function harness(options: { placeholder?: TPlaceholderImpl | false } = {}): Harness {
    let impl: TPlaceholderImpl = options.placeholder ? options.placeholder : NO_PLACEHOLDER;

    const placeholder: Mock<TPlaceholderImpl> = vi.fn((args: number, previous: { data: string; args: number } | null) =>
        impl(args, previous),
    );

    const queue: Array<{ resolve: (value: string) => void; reject: (error: unknown) => void }> = [];
    let started = 0;

    const resource = new Resource<number, string>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: number) => string,
        queryFn: () => {
            started += 1;
            return new Promise<string>((resolve, reject) => {
                queue.push({ resolve, reject });
            });
        },
        ...(options.placeholder === false ? {} : { placeholderData: placeholder }),
    });

    const clutch = resource.createClutch();
    const state = observe(clutch);

    return {
        resource,
        clutch,
        state,
        placeholder,
        setPlaceholder: (next) => {
            impl = next;
        },
        runs: () => started,
        ok: async (value) => {
            queue.shift()!.resolve(value);
            await flushMicrotasks();
        },
        fail: async (error) => {
            queue.shift()!.reject(error);
            await flushMicrotasks();
        },
    };
}

/**
 * Drive a harness to the given matrix row, always on args `1` (and `2` for the
 * rows that hold previous data). Rows 2 / 3, 7 / 13 and 10 / 14 share a script:
 * which of the pair is reached depends on the resource's `placeholderData`.
 */
async function driveTo(t: Harness, row: TRow): Promise<void> {
    switch (row) {
        case 1:
            return;
        case 2:
        case 3:
            t.clutch.switch(1);
            t.clutch.start();
            return;
        case 5:
            t.clutch.switch(1);
            t.clutch.start();
            await t.ok("A1");
            return;
        case 4:
            await driveTo(t, 5);
            t.clutch.switch(2);
            return;
        case 6:
            await driveTo(t, 5);
            t.clutch.invalidate();
            return;
        case 7:
        case 13:
            await driveTo(t, 2);
            await t.fail(FAIL_1);
            return;
        case 8:
            await driveTo(t, 4);
            await t.fail(FAIL_1);
            return;
        case 9:
            await driveTo(t, 6);
            await t.fail(FAIL_1);
            return;
        case 10:
        case 14:
            await driveTo(t, 7);
            t.clutch.retry();
            return;
        case 11:
            await driveTo(t, 8);
            t.clutch.retry();
            return;
        case 12:
            await driveTo(t, 9);
            t.clutch.retry();
            return;
    }
}

let warn!: MockInstance<typeof console.warn>;

beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    // Always unsubscribe effects BEFORE any resource.reset() to avoid
    // infinite reactive loop in getEntry$(args, true) re-creation.
    while (_effects.length) _effects.pop()!.unsubscribe();
    warn.mockRestore();
});

// ==================== Matrix rows ====================

describe("ResourceClutch — matrix rows", () => {
    it("row 1 — SKIP / no args: idle · none", async () => {
        const t = harness();
        await driveTo(t, 1);
        expectRow(t.state(), 1);
    });

    it("row 2 — initial load: pending · none", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 2);
        expectRow(t.state(), 2, { args: 1 });
    });

    it("row 3 — load behind a placeholder: pending · placeholder", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 3);
        expectRow(t.state(), 3, { args: 1, data: "ph-1" });
    });

    it("row 4 — new args, previous data of the old ones: pending · previous", async () => {
        const t = harness();
        await driveTo(t, 4);
        expectRow(t.state(), 4, { args: 2, data: "A1", dataArgs: 1 });
    });

    it("row 5 — success: success · current", async () => {
        const t = harness();
        await driveTo(t, 5);
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("row 6 — invalidation of the current args: pending · current", async () => {
        const t = harness();
        await driveTo(t, 6);
        expectRow(t.state(), 6, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("row 7 — error with nothing to show: error · none", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 7);
        expectRow(t.state(), 7, { args: 1, error: FAIL_1 });
    });

    it("row 8 — error on new args, previous data of the old ones: error · previous", async () => {
        const t = harness();
        await driveTo(t, 8);
        expectRow(t.state(), 8, { args: 2, data: "A1", dataArgs: 1, error: FAIL_1 });
    });

    it("row 9 — failed invalidation: error · current", async () => {
        const t = harness();
        await driveTo(t, 9);
        expectRow(t.state(), 9, { args: 1, data: "A1", dataArgs: 1, error: FAIL_1 });
    });

    it("row 10 — retry of row 7: pending · none · hasError", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 10);
        expectRow(t.state(), 10, { args: 1, error: FAIL_1 });
    });

    it("row 11 — retry of row 8: pending · previous · hasError", async () => {
        const t = harness();
        await driveTo(t, 11);
        expectRow(t.state(), 11, { args: 2, data: "A1", dataArgs: 1, error: FAIL_1 });
    });

    it("row 12 — retry of row 9: pending · current · hasError", async () => {
        const t = harness();
        await driveTo(t, 12);
        expectRow(t.state(), 12, { args: 1, data: "A1", dataArgs: 1, error: FAIL_1 });
    });

    it("row 13 — error behind a placeholder: error · placeholder", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 13);
        expectRow(t.state(), 13, { args: 1, data: "ph-1", error: FAIL_1 });
    });

    it("row 14 — retry of row 13: pending · placeholder · hasError", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 14);
        expectRow(t.state(), 14, { args: 1, data: "ph-1", error: FAIL_1 });
    });
});

// ==================== Transition edges (settle) ====================

describe("ResourceClutch — settle edges", () => {
    it("2 → 5: ok", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 2);
        await t.ok("A1");
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("2 → 7: fail", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 2);
        await t.fail(FAIL_1);
        expectRow(t.state(), 7, { args: 1, error: FAIL_1 });
    });

    it("3 → 5: ok", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 3);
        await t.ok("A1");
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("3 → 13: fail", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 3);
        await t.fail(FAIL_1);
        expectRow(t.state(), 13, { args: 1, data: "ph-1", error: FAIL_1 });
    });

    it("4 → 5: ok", async () => {
        const t = harness();
        await driveTo(t, 4);
        await t.ok("A2");
        expectRow(t.state(), 5, { args: 2, data: "A2", dataArgs: 2 });
    });

    it("4 → 8: fail", async () => {
        const t = harness();
        await driveTo(t, 4);
        await t.fail(FAIL_1);
        expectRow(t.state(), 8, { args: 2, data: "A1", dataArgs: 1, error: FAIL_1 });
    });

    it("6 → 5: ok", async () => {
        const t = harness();
        await driveTo(t, 6);
        await t.ok("A1-v2");
        expectRow(t.state(), 5, { args: 1, data: "A1-v2", dataArgs: 1 });
    });

    it("6 → 9: fail", async () => {
        const t = harness();
        await driveTo(t, 6);
        await t.fail(FAIL_1);
        expectRow(t.state(), 9, { args: 1, data: "A1", dataArgs: 1, error: FAIL_1 });
    });

    it("10 → 5: ok", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 10);
        await t.ok("A1");
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("10 → 7: fail", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 10);
        await t.fail(FAIL_2);
        expectRow(t.state(), 7, { args: 1, error: FAIL_2 });
    });

    it("11 → 5: ok", async () => {
        const t = harness();
        await driveTo(t, 11);
        await t.ok("A2");
        expectRow(t.state(), 5, { args: 2, data: "A2", dataArgs: 2 });
    });

    it("11 → 8: fail", async () => {
        const t = harness();
        await driveTo(t, 11);
        await t.fail(FAIL_2);
        expectRow(t.state(), 8, { args: 2, data: "A1", dataArgs: 1, error: FAIL_2 });
    });

    it("12 → 5: ok", async () => {
        const t = harness();
        await driveTo(t, 12);
        await t.ok("A1-v2");
        expectRow(t.state(), 5, { args: 1, data: "A1-v2", dataArgs: 1 });
    });

    it("12 → 9: fail", async () => {
        const t = harness();
        await driveTo(t, 12);
        await t.fail(FAIL_2);
        expectRow(t.state(), 9, { args: 1, data: "A1", dataArgs: 1, error: FAIL_2 });
    });

    it("14 → 5: ok", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 14);
        await t.ok("A1");
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("14 → 13: fail", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 14);
        await t.fail(FAIL_2);
        expectRow(t.state(), 13, { args: 1, data: "ph-1", error: FAIL_2 });
    });
});

// ==================== Transition edges (retry) ====================

describe("ResourceClutch — retry edges", () => {
    it("7 → 10: retry keeps the failure on screen", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 7);
        const before = t.runs();

        t.clutch.retry();

        expect(t.runs()).toBe(before + 1);
        expectRow(t.state(), 10, { args: 1, error: FAIL_1 });
    });

    it("8 → 11: retry re-queries the failed args, previous data stays", async () => {
        const t = harness();
        await driveTo(t, 8);
        const before = t.runs();

        t.clutch.retry();

        expect(t.runs()).toBe(before + 1);
        expectRow(t.state(), 11, { args: 2, data: "A1", dataArgs: 1, error: FAIL_1 });
    });

    it("9 → 12: retry of a failed invalidation", async () => {
        const t = harness();
        await driveTo(t, 9);
        const before = t.runs();

        t.clutch.retry();

        expect(t.runs()).toBe(before + 1);
        expectRow(t.state(), 12, { args: 1, data: "A1", dataArgs: 1, error: FAIL_1 });
    });

    it("13 → 14: retry behind a placeholder", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 13);
        const before = t.runs();

        t.clutch.retry();

        expect(t.runs()).toBe(before + 1);
        expectRow(t.state(), 14, { args: 1, data: "ph-1", error: FAIL_1 });
    });
});

// ==================== Transition edges (invalidate) ====================

describe("ResourceClutch — invalidate edges", () => {
    it("5 → 6: invalidation of fresh data", async () => {
        const t = harness();
        await driveTo(t, 5);
        const before = t.runs();

        t.clutch.invalidate();

        expect(t.runs()).toBe(before + 1);
        expectRow(t.state(), 6, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("8 → 4: invalidation clears the failure, previous data stays", async () => {
        const t = harness();
        await driveTo(t, 8);
        const before = t.runs();

        t.clutch.invalidate();

        expect(t.runs()).toBe(before + 1);
        expectRow(t.state(), 4, { args: 2, data: "A1", dataArgs: 1 });
    });

    it("9 → 6: invalidation clears the failure of the previous invalidation", async () => {
        const t = harness();
        await driveTo(t, 9);
        const before = t.runs();

        t.clutch.invalidate();

        expect(t.runs()).toBe(before + 1);
        expectRow(t.state(), 6, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("13 → 3: invalidation clears the failure, the placeholder stays", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 13);
        const before = t.runs();
        const placeholderCalls = t.placeholder.mock.calls.length;

        t.clutch.invalidate();

        expect(t.runs()).toBe(before + 1);
        // The memo survives: the option is not consulted a second time.
        expect(t.placeholder.mock.calls.length).toBe(placeholderCalls);
        expectRow(t.state(), 3, { args: 1, data: "ph-1" });
    });
});

// ==================== Undrawn edges: warn + no-op ====================

describe("ResourceClutch — undrawn edges are a warn + no-op", () => {
    const RETRY_ROWS: TRow[] = [2, 3, 4, 5, 6, 10, 11, 12, 14];
    // Row 7 is rejected by the clutch, not by the entry: the entry cannot tell
    // rows 7 / 8 / 13 apart, they are all `error`.
    const INVALIDATE_ROWS: TRow[] = [2, 3, 4, 6, 7, 10, 11, 12, 14];

    /** The placeholder-bearing rows need the option; the others must not see it. */
    function harnessFor(row: TRow): Harness {
        return harness({ placeholder: row === 3 || row === 13 || row === 14 ? ALWAYS_PLACEHOLDER : NO_PLACEHOLDER });
    }

    function fieldsFor(row: TRow): Parameters<typeof expectRow>[2] {
        switch (row) {
            case 2:
                return { args: 1 };
            case 3:
                return { args: 1, data: "ph-1" };
            case 4:
                return { args: 2, data: "A1", dataArgs: 1 };
            case 5:
            case 6:
                return { args: 1, data: "A1", dataArgs: 1 };
            case 7:
                return { args: 1, error: FAIL_1 };
            case 10:
                return { args: 1, error: FAIL_1 };
            case 11:
                return { args: 2, data: "A1", dataArgs: 1, error: FAIL_1 };
            case 12:
                return { args: 1, data: "A1", dataArgs: 1, error: FAIL_1 };
            case 14:
                return { args: 1, data: "ph-1", error: FAIL_1 };
            default:
                throw new Error(`no fixture for row ${row}`);
        }
    }

    it.each(RETRY_ROWS)("retry() from row %i warns and changes nothing", async (row) => {
        const t = harnessFor(row);
        await driveTo(t, row);
        warn.mockClear();
        const before = t.runs();

        expect(() => t.clutch.retry()).not.toThrow();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(t.runs()).toBe(before);
        expectRow(t.state(), row, fieldsFor(row));
    });

    it.each(INVALIDATE_ROWS)("invalidate() from row %i warns and changes nothing", async (row) => {
        const t = harnessFor(row);
        await driveTo(t, row);
        warn.mockClear();
        const before = t.runs();

        expect(() => t.clutch.invalidate()).not.toThrow();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(t.runs()).toBe(before);
        expectRow(t.state(), row, fieldsFor(row));
    });

    it("invalidate() from row 7 is rejected by the clutch, while retry() (7 → 10) still works", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 7);
        warn.mockClear();
        const before = t.runs();

        t.clutch.invalidate();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("[ResourceClutch]");
        expect(t.runs()).toBe(before);
        expectRow(t.state(), 7, { args: 1, error: FAIL_1 });

        warn.mockClear();
        t.clutch.retry();

        expect(warn).not.toHaveBeenCalled();
        expect(t.runs()).toBe(before + 1);
        expectRow(t.state(), 10, { args: 1, error: FAIL_1 });
    });

    it("invalidate() from rows 8 and 13 is a drawn edge and is not rejected", async () => {
        const previous = harness();
        await driveTo(previous, 8);
        warn.mockClear();
        previous.clutch.invalidate();
        expect(warn).not.toHaveBeenCalled();
        expectRow(previous.state(), 4, { args: 2, data: "A1", dataArgs: 1 });

        const placeholder = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(placeholder, 13);
        warn.mockClear();
        placeholder.clutch.invalidate();
        expect(warn).not.toHaveBeenCalled();
        expectRow(placeholder.state(), 3, { args: 1, data: "ph-1" });
    });

    it("row 1 has no cache entry: retry() / invalidate() do nothing at all", async () => {
        const t = harness();
        await driveTo(t, 1);
        warn.mockClear();

        expect(() => t.clutch.retry()).not.toThrow();
        expect(() => t.clutch.invalidate()).not.toThrow();

        expect(warn).not.toHaveBeenCalled();
        expect(t.runs()).toBe(0);
        expectRow(t.state(), 1);
    });
});

// ==================== Args change (new args not in cache) ====================

describe("ResourceClutch — args change, new args not in cache", () => {
    const NEW_ARGS = 99;

    describe("from rows 1, 2, 7, 10 (nothing held)", () => {
        const SOURCES: TRow[] = [1, 2, 7, 10];

        it.each(SOURCES)("row %i → 3 when placeholderData returns { data }", async (row) => {
            const t = harness();
            await driveTo(t, row);
            t.setPlaceholder(ALWAYS_PLACEHOLDER);

            t.clutch.switch(NEW_ARGS);
            t.clutch.start();

            expectRow(t.state(), 3, { args: NEW_ARGS, data: `ph-${NEW_ARGS}` });
        });

        it.each(SOURCES)("row %i → 2 when placeholderData returns null", async (row) => {
            const t = harness();
            await driveTo(t, row);

            t.clutch.switch(NEW_ARGS);
            t.clutch.start();

            expectRow(t.state(), 2, { args: NEW_ARGS });
        });

        it.each(SOURCES)("row %i → 2 without the placeholderData option", async (row) => {
            const t = harness({ placeholder: false });
            await driveTo(t, row);

            t.clutch.switch(NEW_ARGS);
            t.clutch.start();

            expectRow(t.state(), 2, { args: NEW_ARGS });
        });
    });

    describe("from rows 3, 13, 14 (a placeholder on screen)", () => {
        const SOURCES: TRow[] = [3, 13, 14];

        /** Drive to a placeholder row with no previous data behind the placeholder. */
        async function withoutPrevious(t: Harness, row: TRow): Promise<void> {
            t.setPlaceholder(ALWAYS_PLACEHOLDER);
            await driveTo(t, row);
        }

        /** Drive to a placeholder row that hides the previous args' data. */
        async function withPrevious(t: Harness, row: TRow): Promise<void> {
            await driveTo(t, 5);
            t.setPlaceholder(ALWAYS_PLACEHOLDER);
            // From row 5 the same scripts land on the placeholder rows for args 2.
            t.clutch.switch(2);
            if (row === 13 || row === 14) await t.fail(FAIL_1);
            if (row === 14) t.clutch.retry();
        }

        it.each(SOURCES)("row %i → 3 when placeholderData returns { data }", async (row) => {
            const t = harness();
            await withoutPrevious(t, row);

            t.clutch.switch(NEW_ARGS);

            expectRow(t.state(), 3, { args: NEW_ARGS, data: `ph-${NEW_ARGS}` });
        });

        it.each(SOURCES)("row %i → 4 when null and previous data was held behind the placeholder", async (row) => {
            const t = harness();
            await withPrevious(t, row);
            expect(t.state().dataSource).toBe(MATRIX[row].dataSource);
            t.setPlaceholder(NO_PLACEHOLDER);

            t.clutch.switch(NEW_ARGS);

            expectRow(t.state(), 4, { args: NEW_ARGS, data: "A1", dataArgs: 1 });
        });

        it.each(SOURCES)("row %i → 2 when null and there was no previous data", async (row) => {
            const t = harness();
            await withoutPrevious(t, row);
            t.setPlaceholder(NO_PLACEHOLDER);

            t.clutch.switch(NEW_ARGS);

            expectRow(t.state(), 2, { args: NEW_ARGS });
        });
    });

    describe("from rows 4, 5, 6, 8, 9, 11, 12 (previous data held)", () => {
        const SOURCES: TRow[] = [4, 5, 6, 8, 9, 11, 12];

        it.each(SOURCES)("row %i → 3 when placeholderData returns { data }", async (row) => {
            const t = harness();
            await driveTo(t, row);
            t.setPlaceholder(ALWAYS_PLACEHOLDER);

            t.clutch.switch(NEW_ARGS);

            expectRow(t.state(), 3, { args: NEW_ARGS, data: `ph-${NEW_ARGS}` });
        });

        it.each(SOURCES)("row %i → 4 when placeholderData returns null", async (row) => {
            const t = harness();
            await driveTo(t, row);

            t.clutch.switch(NEW_ARGS);

            expectRow(t.state(), 4, { args: NEW_ARGS, data: "A1", dataArgs: 1 });
        });

        it.each(SOURCES)("row %i → 4 without the placeholderData option", async (row) => {
            const t = harness({ placeholder: false });
            await driveTo(t, row);

            t.clutch.switch(NEW_ARGS);

            expectRow(t.state(), 4, { args: NEW_ARGS, data: "A1", dataArgs: 1 });
        });
    });

    describe("cache hit on args change", () => {
        it("goes straight to row 5 and never asks placeholderData", async () => {
            const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
            await driveTo(t, 5);

            t.resource.getEntry(2, true);
            await t.ok("A2");
            t.placeholder.mockClear();

            t.clutch.switch(2);

            expectRow(t.state(), 5, { args: 2, data: "A2", dataArgs: 2 });
            expect(t.placeholder).not.toHaveBeenCalled();
        });

        it("goes to row 6 when the cached entry is stale and revalidating", async () => {
            const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
            await driveTo(t, 5);

            t.resource.getEntry(2, true);
            await t.ok("A2");
            t.resource.invalidate(2);
            t.placeholder.mockClear();

            t.clutch.switch(2);

            expectRow(t.state(), 6, { args: 2, data: "A2", dataArgs: 2 });
            expect(t.placeholder).not.toHaveBeenCalled();
        });
    });
});

// ==================== Invariants ====================

describe("ResourceClutch — invariants", () => {
    const ALL_ROWS = Object.keys(MATRIX).map(Number) as TRow[];

    async function stateOf(row: TRow): Promise<TResourceClutchState<number, string>> {
        const t = harness({
            placeholder: row === 3 || row === 13 || row === 14 ? ALWAYS_PLACEHOLDER : NO_PLACEHOLDER,
        });
        await driveTo(t, row);
        return t.state();
    }

    it.each(ALL_ROWS)("row %i: exactly one loading flag is true while pending", async (row) => {
        const st = await stateOf(row);
        const loadingFlags = [st.isInitialLoading, st.isSwitching, st.isInvalidating].filter(Boolean).length;

        expect(st.isPending).toBe(st.status === "pending");
        expect(loadingFlags).toBe(st.isPending ? 1 : 0);
    });

    it.each(ALL_ROWS)("row %i: hasData ⇔ dataSource !== none, hasError ⇔ error !== null", async (row) => {
        const st = await stateOf(row);

        expect(st.hasData).toBe(st.dataSource !== "none");
        expect(st.hasData).toBe(st.data !== null);
        expect(st.hasError).toBe(st.error !== null);
    });

    it("success ⇒ dataSource === current and no error", async () => {
        const st = await stateOf(5);
        expect(st.status).toBe("success");
        expect(st.dataSource).toBe("current");
        expect(st.hasError).toBe(false);
    });

    it("error ⇒ hasError", async () => {
        for (const row of [7, 8, 9, 13] as TRow[]) {
            const st = await stateOf(row);
            expect(st.status).toBe("error");
            expect(st.hasError).toBe(true);
        }
    });

    it("idle ⇒ dataSource === none and no error", async () => {
        const st = await stateOf(1);
        expect(st.status).toBe("idle");
        expect(st.dataSource).toBe("none");
        expect(st.hasError).toBe(false);
    });

    it("rows 10, 11, 12 and 14 are hasError without status === error", async () => {
        for (const row of [10, 11, 12, 14] as TRow[]) {
            const st = await stateOf(row);
            expect(st.status).toBe("pending");
            expect(st.hasError).toBe(true);
        }
    });
});

// ==================== whenSettled ====================
//
// Settled ⇔ the clutch has something to render (`hasData`) or failed with
// nothing to show (`status === "error"`). Rows 1, 2 and 10 are the only
// unsettled ones.

describe("ResourceClutch.whenSettled", () => {
    it("stays pending on rows 1, 2 and 10 and resolves once data arrives", async () => {
        const t = harness({ placeholder: false });
        let settled = false;
        void t.clutch.whenSettled().then(() => {
            settled = true;
        });

        await driveTo(t, 2);
        await flushMicrotasks();
        expect(settled).toBe(false);

        await t.ok("A1");
        await flushMicrotasks();
        expect(settled).toBe(true);
    });

    it("resolves on an error with nothing to show (row 7)", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 7);
        await expect(t.clutch.whenSettled()).resolves.toBeUndefined();
    });

    it("resolves on a placeholder (row 3) — there is something to render", async () => {
        const t = harness({ placeholder: ALWAYS_PLACEHOLDER });
        await driveTo(t, 3);
        await expect(t.clutch.whenSettled()).resolves.toBeUndefined();
    });

    it("resolves while switching over previous data (row 4)", async () => {
        const t = harness();
        await driveTo(t, 4);
        await expect(t.clutch.whenSettled()).resolves.toBeUndefined();
    });

    it("does not resolve on a retry with nothing to show (row 10)", async () => {
        const t = harness({ placeholder: false });
        await driveTo(t, 10);

        let settled = false;
        void t.clutch.whenSettled().then(() => {
            settled = true;
        });
        await flushMicrotasks();
        expect(settled).toBe(false);
    });
});

// ==================== start / switch / SKIP ====================

describe("ResourceClutch.start(args)", () => {
    it("idle → pending → success", async () => {
        const t = harness();
        expectRow(t.state(), 1);

        t.clutch.switch(1);
        t.clutch.start();
        expectRow(t.state(), 2, { args: 1 });

        await t.ok("A1");
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });
});

describe("ResourceClutch.switch(args)", () => {
    it("does not start a fetch (lazy)", async () => {
        const t = harness();
        t.clutch.switch(1);
        await flushMicrotasks();
        expect(t.runs()).toBe(0);
        expectRow(t.state(), 1);
    });

    it("reflects an existing cache entry", async () => {
        const t = harness();
        t.resource.getEntry(1, true);
        await t.ok("A1");

        t.clutch.switch(1);
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("with the same args is a no-op (no new fetch, same state)", async () => {
        const t = harness();
        await driveTo(t, 5);

        t.clutch.switch(1);
        await flushMicrotasks();

        expect(t.runs()).toBe(1);
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });
});

describe("ResourceClutch.switch(SKIP)", () => {
    it("resets to row 1", async () => {
        const t = harness();
        await driveTo(t, 5);

        t.clutch.switch(SKIP);
        expectRow(t.state(), 1);
    });

    it("clears the previous entry — no SWR after SKIP", async () => {
        const t = harness();
        await driveTo(t, 5);

        t.clutch.switch(SKIP);
        t.clutch.switch(2);

        expectRow(t.state(), 2, { args: 2 });
    });
});

describe("ResourceClutch.switch() then start()", () => {
    it("transitions from lazy to eager (triggers the fetch)", async () => {
        const t = harness();

        t.clutch.switch(1);
        await flushMicrotasks();
        expect(t.runs()).toBe(0);

        t.clutch.start();
        expect(t.runs()).toBe(1);

        await t.ok("A1");
        expectRow(t.state(), 5, { args: 1, data: "A1", dataArgs: 1 });
    });
});

// ==================== SWR across multiple args changes ====================

describe("ResourceClutch SWR", () => {
    it("dataArgs keeps pointing at the surviving previous entry across several args changes", async () => {
        const t = harness();
        await driveTo(t, 5);

        t.clutch.switch(2);
        t.clutch.switch(3);
        expectRow(t.state(), 4, { args: 3, data: "A1", dataArgs: 1 });

        // Settle the run of args 2 first — it is not the tracked one anymore.
        await t.ok("A2");
        expectRow(t.state(), 4, { args: 3, data: "A1", dataArgs: 1 });

        await t.ok("A3");
        expectRow(t.state(), 5, { args: 3, data: "A3", dataArgs: 3 });
    });

    it("an invalidation of the same entry is row 6, not row 4", async () => {
        const t = harness();
        await driveTo(t, 5);

        t.clutch.switch(2);
        expectRow(t.state(), 4, { args: 2, data: "A1", dataArgs: 1 });

        await t.ok("A2");
        expectRow(t.state(), 5, { args: 2, data: "A2", dataArgs: 2 });

        t.clutch.invalidate();
        expectRow(t.state(), 6, { args: 2, data: "A2", dataArgs: 2 });

        await t.ok("A2-v2");
        expectRow(t.state(), 5, { args: 2, data: "A2-v2", dataArgs: 2 });
    });
});

// ==================== adoptPrevious ====================

describe("ResourceClutch.adoptPrevious", () => {
    it("hands the previous data over to a successor clutch (row 4)", async () => {
        const t = harness();
        await driveTo(t, 5);

        const next = t.resource.createClutch();
        const nextState = observe(next);
        next.adoptPrevious(t.clutch);
        next.switch(2, { markPending: true });

        expectRow(nextState(), 4, { args: 2, data: "A1", dataArgs: 1 });
    });
});

// ==================== dispose / reset ====================

describe("ResourceClutch dispose", () => {
    it("stops tracking after the effect is unsubscribed", async () => {
        const t = harness();
        const statuses: string[] = [];
        const eff = Signal.effect(() => {
            statuses.push(t.clutch.state$().status);
        });
        _effects.push(eff);

        t.clutch.switch(1);
        t.clutch.start();
        await t.ok("A1");
        const countBefore = statuses.length;

        eff.unsubscribe();

        t.clutch.switch(2);
        await flushMicrotasks();
        expect(statuses.length).toBe(countBefore);
    });
});

describe("ResourceClutch reset() on active clutch (regression)", () => {
    it("resource.reset() while the clutch is subscribed does not cause an infinite loop", async () => {
        const t = harness();
        await driveTo(t, 5);
        expect(t.runs()).toBe(1);

        // reset() used to trigger an infinite reactive loop where getEntry$
        // kept recreating entries after cache clear.
        t.resource.reset();
        await flushMicrotasks();

        // A bounded call-count check acts as the loop detector.
        expect(t.runs()).toBeLessThanOrEqual(3);
        expect(["idle", "pending", "success"]).toContain(t.state().status);
    });
});

// ==================== Non-last entry removal (N1 regression) ====================
//
// The clutch holds its tracked entry through `current$` (a getEntry$ signal). When
// the tracked entry is NOT the last one created and is removed while the clutch is
// unmounted (state$ read only via peek — no live subscription), current$ must stop
// yielding the completed entry, or every reader of `entry.state$.peek()` hits a
// disposed state and throws "No value emitted".

describe("ResourceClutch — non-last entry removal (N1 regression)", () => {
    function twoEntryResource() {
        const resource = new Resource<number, string>({
            retentionTime: false,
            serializeArgs: stableStringify as (args: number) => string,
            queryFn: async (n: number) => `d-${n}`,
        });
        return resource;
    }

    it("switch() to new args does not throw when the tracked NON-last entry was removed", async () => {
        const resource = twoEntryResource();
        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        expect(clutch.state$.peek().data).toBe("d-1"); // prime current$ with the live entry

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(() => clutch.switch(3)).not.toThrow();
    });

    it("retry()/invalidate() are no-throw no-ops when the tracked NON-last entry was removed", async () => {
        const resource = twoEntryResource();
        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        expect(clutch.state$.peek().data).toBe("d-1");

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(() => clutch.retry()).not.toThrow();
        expect(() => clutch.invalidate()).not.toThrow();
    });

    it("reading state$ does not throw after the tracked NON-last entry is removed", async () => {
        const resource = twoEntryResource();
        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        expect(clutch.state$.peek().data).toBe("d-1");

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(() => clutch.state$.peek()).not.toThrow();
    });
});

// ==================== Stale re-create on rapid args change (microtask) ====================
//
// _deriveState schedules a deferred re-create — queueMicrotask(getEntry(tracking.keyed, true)) —
// when the clutch is started and its tracked entry is absent (evicted-while-tracked). If args
// advance within the SAME tick before the microtask fires, the stale key must NOT be re-created.

describe("ResourceClutch — stale re-trigger on rapid args change (microtask)", () => {
    function evictableResource() {
        return new Resource<number, string>({
            retentionTime: false,
            serializeArgs: stableStringify as (args: number) => string,
            queryFn: async (n: number) => `d-${n}`,
        });
    }

    it("does not trigger the evicted-then-superseded key when args advance within one tick", async () => {
        const resource = evictableResource();
        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        clutch.start();
        expect(clutch.state$.peek().status).toBe("success");

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        const createSpy = vi.spyOn(resource, "getEntry");

        expect(clutch.state$.peek().status).toBe("pending");

        clutch.switch(3);
        await flushMicrotasks();

        const staleCalls = createSpy.mock.calls.filter(
            ([keyed, doInitiate]) => doInitiate === true && (keyed as { value: number }).value === 1,
        );
        expect(staleCalls).toHaveLength(0);
    });

    it("re-triggers the same key after eviction when args are unchanged", async () => {
        const resource = evictableResource();
        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        clutch.start();
        expect(clutch.state$.peek().status).toBe("success");

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        const createSpy = vi.spyOn(resource, "getEntry");
        expect(clutch.state$.peek().status).toBe("pending");
        await flushMicrotasks();

        const recreated = createSpy.mock.calls.some(
            ([keyed, doInitiate]) => doInitiate === true && (keyed as { value: number }).value === 1,
        );
        expect(recreated).toBe(true);
    });
});

// ==================== Deprecated aliases ====================

describe("ResourceClutch — deprecated aliases", () => {
    it("set(args, mark) forwards to switch(args, { markPending: mark })", () => {
        const t = harness();
        const switchSpy = vi.spyOn(t.clutch, "switch");

        t.clutch.set(1, true);
        expect(switchSpy).toHaveBeenCalledTimes(1);
        expect(switchSpy).toHaveBeenLastCalledWith(1, { markPending: true });

        t.clutch.set(2);
        expect(switchSpy).toHaveBeenCalledTimes(2);
        expect(switchSpy).toHaveBeenLastCalledWith(2, { markPending: false });
    });

    it("set(args, true) marks an unstarted clutch as pending, exactly as markPending does", () => {
        const t = harness();
        t.clutch.set(1, true);
        expectRow(t.state(), 2, { args: 1 });

        const unmarked = t.resource.createClutch();
        const unmarkedState = observe(unmarked);
        unmarked.set(1);
        expectRow(unmarkedState(), 1);
    });

    it("refresh() forwards to invalidate(), including through a destructured reference", async () => {
        const t = harness();
        await driveTo(t, 5);

        const invalidateSpy = vi.spyOn(t.clutch, "invalidate");
        const { refresh } = t.clutch;
        refresh();

        expect(invalidateSpy).toHaveBeenCalledTimes(1);
        expectRow(t.state(), 6, { args: 1, data: "A1", dataArgs: 1 });

        await t.ok("A1-v2");
        expectRow(t.state(), 5, { args: 1, data: "A1-v2", dataArgs: 1 });
    });

    it("state$ exposes refresh as a forwarder to invalidate", async () => {
        const t = harness();
        expect(typeof t.state().refresh).toBe("function");

        await driveTo(t, 5);

        const invalidateSpy = vi.spyOn(t.clutch, "invalidate");
        t.state().refresh();

        expect(invalidateSpy).toHaveBeenCalledTimes(1);
        expectRow(t.state(), 6, { args: 1, data: "A1", dataArgs: 1 });
    });

    it("state$ delegates retry() and invalidate()", async () => {
        const t = harness();
        await driveTo(t, 5);

        t.state().invalidate();
        await t.ok("A1-v2");
        expectRow(t.state(), 5, { args: 1, data: "A1-v2", dataArgs: 1 });
    });
});

// ==================== Nullable TData ====================
//
// `dataSource` — not `data` — is the source of truth about presence, because
// `TData` may itself be `null`. An entry that successfully loaded `null` holds
// data (row 5, `hasData: true`), so it is a valid SWR fallback and a valid
// `previous` for `placeholderData`.

describe("ResourceClutch — nullable TData", () => {
    interface NullableHarness {
        clutch: IResourceClutch<number, string | null>;
        state: () => TResourceClutchState<number, string | null>;
        placeholder: Mock<NonNullable<IResourceConfig<number, string | null>["placeholderData"]>>;
        ok: (value: string | null) => Promise<void>;
        fail: (error: unknown) => Promise<void>;
    }

    function nullableHarness(withPlaceholder = false): NullableHarness {
        const queue: Array<{ resolve: (value: string | null) => void; reject: (error: unknown) => void }> = [];

        const placeholder = vi.fn<NonNullable<IResourceConfig<number, string | null>["placeholderData"]>>(() => null);

        const resource = new Resource<number, string | null>({
            retentionTime: false,
            serializeArgs: stableStringify as (args: number) => string,
            queryFn: () =>
                new Promise<string | null>((resolve, reject) => {
                    queue.push({ resolve, reject });
                }),
            ...(withPlaceholder ? { placeholderData: placeholder } : {}),
        });

        const clutch = resource.createClutch();
        let latest!: TResourceClutchState<number, string | null>;
        const eff = Signal.effect(() => {
            latest = clutch.state$();
        });
        _effects.push(eff);

        return {
            clutch,
            state: () => latest,
            placeholder,
            ok: async (value) => {
                queue.shift()!.resolve(value);
                await flushMicrotasks();
            },
            fail: async (error) => {
                queue.shift()!.reject(error);
                await flushMicrotasks();
            },
        };
    }

    it("row 5 — a query that resolved null still holds data", async () => {
        const t = nullableHarness();
        t.clutch.switch(1);
        t.clutch.start();
        await t.ok(null);

        expect(t.state().status).toBe("success");
        expect(t.state().dataSource).toBe("current");
        expect(t.state().hasData).toBe(true);
        expect(t.state().data).toBeNull();
    });

    it("row 4 — null data of the previous args is kept while the new ones load", async () => {
        const t = nullableHarness();
        t.clutch.switch(1);
        t.clutch.start();
        await t.ok(null);

        t.clutch.switch(2);

        expect(t.state().status).toBe("pending");
        expect(t.state().dataSource).toBe("previous");
        expect(t.state().hasData).toBe(true);
        expect(t.state().isSwitching).toBe(true);
        expect(t.state().data).toBeNull();
        expect(t.state().dataArgs).toBe(1);
        expect(t.state().args).toBe(2);
    });

    it("row 8 — null data of the previous args survives a failure of the new ones", async () => {
        const t = nullableHarness();
        t.clutch.switch(1);
        t.clutch.start();
        await t.ok(null);

        t.clutch.switch(2);
        await t.fail(FAIL_1);

        expect(t.state().status).toBe("error");
        expect(t.state().dataSource).toBe("previous");
        expect(t.state().hasData).toBe(true);
        expect(t.state().hasError).toBe(true);
        expect(t.state().error).toBe(FAIL_1);
        expect(t.state().data).toBeNull();
        expect(t.state().dataArgs).toBe(1);
    });

    it("placeholderData receives null previous data as a present fallback", async () => {
        const t = nullableHarness(true);
        t.clutch.switch(1);
        t.clutch.start();
        await t.ok(null);

        t.placeholder.mockClear();
        t.clutch.switch(2);

        expect(t.placeholder).toHaveBeenCalledTimes(1);
        expect(t.placeholder).toHaveBeenCalledWith(2, { data: null, args: 1 });
    });
});
