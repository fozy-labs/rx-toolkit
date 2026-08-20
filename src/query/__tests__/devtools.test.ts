import { afterEach, describe, expect, it } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import type { DevtoolsLike } from "@/common/devtools";
import { SharedOptions } from "@/common/options/SharedOptions";
import { QueryCacheEntry } from "@/query/core/cache";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import { toKeyed } from "@/query/lib/toKeyed";
import type { IQueryCacheEntryOptions, IResourceConfig } from "@/query/types";

// ==================== Helpers ====================

type TPush = { key: string; value: unknown; actionName: string | undefined };

/** Installs a recording devtools driver and exposes the captured traffic. */
function installDevtools() {
    const created: Array<{ key: string; initState: unknown }> = [];
    const pushes: TPush[] = [];

    const devtools: DevtoolsLike = {
        state<T>(key: string, initState: T) {
            created.push({ key, initState });

            return (value: T, actionName?: string) => {
                pushes.push({ key, value, actionName });
            };
        },
    };

    SharedOptions.DEVTOOLS = devtools;

    return {
        created,
        pushes,
        /** Action names in push order. */
        actions: () => pushes.map((push) => push.actionName),
    };
}

function createResource<TArgs, TData>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
) {
    return new Resource<TArgs, TData>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: TArgs) => string,
        ...overrides,
    });
}

function createEntry<TArgs, TData>(
    overrides: Partial<IQueryCacheEntryOptions<TArgs, TData>> & {
        queryFn: IQueryCacheEntryOptions<TArgs, TData>["queryFn"];
        keyedArgs: IQueryCacheEntryOptions<TArgs, TData>["keyedArgs"];
    },
) {
    return new QueryCacheEntry<TArgs, TData>({
        retentionTime: false,
        resourceKey: "user",
        ...overrides,
    });
}

afterEach(() => {
    SharedOptions.reset();
});

// ==================== Action names ====================

describe("query devtools — action names", () => {
    it('labels a settled query as "success"', async () => {
        const devtools = installDevtools();
        const resource = createResource<number, string>({
            key: "user",
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(devtools.created.map((entry) => entry.key)).toEqual(["user:1"]);
        expect(devtools.actions()).toEqual(["success"]);
    });

    it('labels a failed query as "error"', async () => {
        const devtools = installDevtools();
        const resource = createResource<number, string>({
            key: "user",
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(devtools.actions()).toEqual(["error"]);
    });

    it('labels retry as "retry" and its outcome as "success"', async () => {
        const devtools = installDevtools();
        let attempt = 0;
        const resource = createResource<number, string>({
            key: "user",
            queryFn: async () => {
                attempt += 1;
                if (attempt === 1) throw new Error("boom");
                return "data";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        resource.getEntry(1, true).retry();
        await flushMicrotasks();

        expect(devtools.actions()).toEqual(["error", "retry", "success"]);
    });

    it('labels refresh as "refresh" and the refreshed result as "rebase"', async () => {
        const devtools = installDevtools();
        let attempt = 0;
        const resource = createResource<number, string>({
            key: "user",
            queryFn: async () => {
                attempt += 1;
                return `data-${attempt}`;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        resource.refresh(1);
        await flushMicrotasks();

        expect(devtools.actions()).toEqual(["success", "refresh", "rebase"]);
    });

    it('labels optimistic patches as "patch" and their settle as "patch-settled"', async () => {
        const devtools = installDevtools();
        const resource = createResource<number, { count: number }>({
            key: "user",
            queryFn: async () => ({ count: 1 }),
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const handle = resource.getEntry(1, true).createPatch((data) => {
            data.count = 2;
        });
        handle!.commit();

        expect(devtools.actions()).toEqual(["success", "patch", "patch-settled"]);
    });

    it('labels a failed background refresh as "refresh-error", not "error"', async () => {
        const devtools = installDevtools();
        let attempt = 0;
        const resource = createResource<number, string>({
            key: "user",
            queryFn: async () => {
                attempt += 1;
                if (attempt === 2) throw new Error("boom");
                return "data";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        resource.refresh(1);
        await flushMicrotasks();

        expect(devtools.actions()).toEqual(["success", "refresh", "refresh-error"]);
    });

    it('labels an aborted patch as "patch-settled" too', async () => {
        const devtools = installDevtools();
        const resource = createResource<number, { count: number }>({
            key: "user",
            queryFn: async () => ({ count: 1 }),
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const handle = resource.getEntry(1, true).createPatch((data) => {
            data.count = 2;
        });
        handle!.abort();

        expect(devtools.actions()).toEqual(["success", "patch", "patch-settled"]);
    });
    it('labels cross-tab data as "sync"', async () => {
        const devtools = installDevtools();
        const resource = createResource<number, string>({
            key: "user",
            queryFn: async () => "from-server",
            beforeQuery: async () => ({ data: "from-tab" }),
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        await flushMicrotasks();

        expect(devtools.actions()).toEqual(["sync"]);
    });

    it("sends $COMPLETED without an action name when the entry is removed", async () => {
        const devtools = installDevtools();
        const resource = createResource<number, string>({
            key: "user",
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        resource.getEntry(1, true).complete();

        expect(devtools.pushes.at(-1)).toEqual({
            key: "user:1",
            value: "$COMPLETED",
            actionName: undefined,
        });
    });
});

// ==================== beforeDevtoolsPush ====================

describe("query devtools — beforeDevtoolsPush", () => {
    it("receives the action name and can forward it", async () => {
        const devtools = installDevtools();
        const entry = createEntry<number, string>({
            queryFn: async () => "data",
            keyedArgs: toKeyed(1),
            beforeDevtoolsPush: (machine, push, actionName) => {
                push(machine, actionName === undefined ? undefined : `wrapped:${actionName}`);
            },
        });

        await flushMicrotasks();

        expect(devtools.actions()).toEqual(["wrapped:success"]);

        entry.complete();
    });

    it("can drop a push, keeping the entry out of the tree until it passes", async () => {
        const devtools = installDevtools();
        const entry = createEntry<number, string>({
            queryFn: async () => "data",
            keyedArgs: toKeyed(1),
            beforeDevtoolsPush: (machine, push) => {
                if (machine.state.status !== "pending") push(machine);
            },
        });

        expect(devtools.created).toEqual([]);

        await flushMicrotasks();

        expect(devtools.created.map((created) => created.key)).toEqual(["user:1"]);
        expect(devtools.pushes).toEqual([]);

        entry.complete();
    });
});
