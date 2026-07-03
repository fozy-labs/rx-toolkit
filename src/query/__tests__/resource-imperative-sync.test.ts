import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IResourceConfig } from "@/query/types";

// ==================== Helpers ====================

function createResource<TArgs = void, TData = string>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
) {
    return new Resource<TArgs, TData>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: TArgs) => string,
        key: "res",
        ...overrides,
    });
}

// ==================== ensure / fetch / prefetch × beforeQuery ====================
//
// When beforeQuery (cross-tab sync) is configured, a cold entry is created via
// _createEntryWithBeforeQuery with an explicit pending Machine, so queryFn does
// not auto-execute and `_execution` stays null until beforeQuery settles.
// The imperative fetch API must await that flow instead of treating the missing
// execution as a removed entry.

describe("Resource.ensure with beforeQuery (cross-tab sync)", () => {
    it("resolves with data handed over by another tab", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => ({ data: "from-tab" as string }));

        const resource = createResource<number, string>({ queryFn, beforeQuery });

        await expect(resource.ensure(1)).resolves.toBe("from-tab");
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("resolves with queryFn data when no tab answers (beforeQuery → null)", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => null);

        const resource = createResource<number, string>({ queryFn, beforeQuery });

        await expect(resource.ensure(1)).resolves.toBe("from-query");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("awaits an entry created by trigger() while beforeQuery is still in flight", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => null);

        const resource = createResource<number, string>({ queryFn, beforeQuery });

        resource.trigger(1);
        // Entry exists, machine is pending, beforeQuery has not settled yet.
        await expect(resource.ensure(1)).resolves.toBe("from-query");
    });

    it("rejects with the query error when the fallback query fails", async () => {
        const queryFn = vi.fn(async () => {
            throw new Error("boom");
        });
        const beforeQuery = vi.fn(async () => null);

        const resource = createResource<number, string>({ queryFn, beforeQuery });

        await expect(resource.ensure(1)).rejects.toThrow("boom");
    });
});

describe("Resource.fetch with beforeQuery (cross-tab sync)", () => {
    it("resolves with fresh data on a cold entry", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => null);

        const resource = createResource<number, string>({ queryFn, beforeQuery });

        await expect(resource.fetch(1)).resolves.toBe("from-query");
    });
});

describe("Resource.prefetch with beforeQuery (cross-tab sync)", () => {
    it("warms the cache before resolving", async () => {
        let resolveQuery!: (v: string) => void;
        const queryFn = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        );
        const beforeQuery = vi.fn(async () => null);

        const resource = createResource<number, string>({ queryFn, beforeQuery });

        let isSettled = false;
        const prefetched = resource.prefetch(1).then(() => {
            isSettled = true;
        });

        // beforeQuery resolves to null → queryFn starts; prefetch must still be pending.
        await flushMicrotasks();
        expect(isSettled).toBe(false);

        resolveQuery("from-query");
        await prefetched;

        const entry = resource.getEntry(1)!;
        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("from-query");
    });
});
