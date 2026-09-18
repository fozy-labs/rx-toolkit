import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { SKIP } from "@/query/constants";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IResourceClutch, IResourceConfig, TResourceClutchState } from "@/query/types";
import { Signal } from "@/signals/signals/Signal";

// The `placeholderData` engine: a lazy `{ key, result }` memo living next to the
// clutch's SWR fallback. This file covers the memo rules of the spec's engine
// section; the matrix rows it produces (3 / 13 / 14) live in resource-clutch.test.ts.

type TPlaceholderImpl = NonNullable<IResourceConfig<number, string>["placeholderData"]>;
type TPrevious = { data: string; args: number } | null;

const FAIL = new Error("fail");

const _effects: Array<{ unsubscribe: () => void }> = [];

afterEach(() => {
    while (_effects.length) _effects.pop()!.unsubscribe();
});

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
    placeholder: Mock<TPlaceholderImpl>;
    setPlaceholder: (impl: TPlaceholderImpl) => void;
    ok: (value: string) => Promise<void>;
    /** Settle the oldest in-flight run of the given args. */
    okFor: (args: number, value: string) => Promise<void>;
    fail: (error: unknown) => Promise<void>;
    clutch: () => { clutch: IResourceClutch<number, string>; state: () => TResourceClutchState<number, string> };
}

function harness(initial: TPlaceholderImpl = () => null): Harness {
    let impl = initial;

    const placeholder: Mock<TPlaceholderImpl> = vi.fn((args: number, previous: TPrevious) => impl(args, previous));

    const queue: Array<{ args: number; resolve: (value: string) => void; reject: (error: unknown) => void }> = [];

    const resource = new Resource<number, string>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: number) => string,
        queryFn: (args: number) =>
            new Promise<string>((resolve, reject) => {
                queue.push({ args, resolve, reject });
            }),
        placeholderData: placeholder,
    });

    return {
        resource,
        placeholder,
        setPlaceholder: (next) => {
            impl = next;
        },
        ok: async (value) => {
            queue.shift()!.resolve(value);
            await flushMicrotasks();
        },
        okFor: async (args, value) => {
            const index = queue.findIndex((run) => run.args === args);
            queue.splice(index, 1)[0]!.resolve(value);
            await flushMicrotasks();
        },
        fail: async (error) => {
            queue.shift()!.reject(error);
            await flushMicrotasks();
        },
        clutch: () => {
            const clutch = resource.createClutch();
            return { clutch, state: observe(clutch) };
        },
    };
}

const SKELETON: TPlaceholderImpl = (args) => ({ data: `ph-${args}` });

// ==================== One call per args key ====================

describe("placeholderData — one call per args key", () => {
    it("is called once for the key, not again on re-derivation", async () => {
        const t = harness(SKELETON);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();

        expect(t.placeholder).toHaveBeenCalledTimes(1);
        expect(t.placeholder).toHaveBeenCalledWith(1, null);
        expect(state().data).toBe("ph-1");

        // Re-reading the derived state must not recompute the memo.
        expect(clutch.state$.peek().data).toBe("ph-1");
        expect(clutch.state$.peek().data).toBe("ph-1");
        expect(t.placeholder).toHaveBeenCalledTimes(1);
    });

    it("a retry does not recompute it (rows 13 → 14)", async () => {
        const t = harness(SKELETON);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();
        await t.fail(FAIL);
        expect(state().dataSource).toBe("placeholder");
        expect(t.placeholder).toHaveBeenCalledTimes(1);

        clutch.retry();

        expect(t.placeholder).toHaveBeenCalledTimes(1);
        expect(state().data).toBe("ph-1");
        expect(state().dataSource).toBe("placeholder");
    });

    it("an invalidation does not recompute it (rows 13 → 3)", async () => {
        const t = harness(SKELETON);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();
        await t.fail(FAIL);
        expect(t.placeholder).toHaveBeenCalledTimes(1);

        clutch.invalidate();

        expect(t.placeholder).toHaveBeenCalledTimes(1);
        expect(state().dataSource).toBe("placeholder");
        expect(state().data).toBe("ph-1");
    });

    it("switching back to the same args while still loading does not recompute it", async () => {
        const t = harness(SKELETON);
        const { clutch } = t.clutch();

        clutch.switch(1);
        clutch.start();
        clutch.switch(1);

        expect(t.placeholder).toHaveBeenCalledTimes(1);
    });
});

// ==================== `previous` is a snapshot ====================

describe("placeholderData — the `previous` argument", () => {
    it("receives the SWR fallback of the moment", async () => {
        const t = harness(() => null);
        const { clutch } = t.clutch();

        clutch.switch(1);
        clutch.start();
        await t.ok("A1");

        t.placeholder.mockClear();
        clutch.switch(2);

        expect(t.placeholder).toHaveBeenCalledTimes(1);
        expect(t.placeholder).toHaveBeenCalledWith(2, { data: "A1", args: 1 });
    });

    it("is the snapshot of the first call: a background update of the previous entry does not recompute", async () => {
        const seen: TPrevious[] = [];
        const t = harness((args, previous) => {
            seen.push(previous);
            return { data: `ph-${args}` };
        });
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();
        await t.ok("A1");

        clutch.switch(2);
        // One call per key: `null` for the cold load of args 1, the fallback for args 2.
        expect(seen).toEqual([null, { data: "A1", args: 1 }]);

        // Update the previous entry in the background — it is still the SWR
        // fallback, but the memo was already computed.
        t.resource.invalidate(1);
        await t.okFor(1, "A1-v2");

        expect(t.placeholder).toHaveBeenCalledTimes(2);
        expect(seen).toEqual([null, { data: "A1", args: 1 }]);
        expect(state().data).toBe("ph-2");
        expect(state().dataSource).toBe("placeholder");
    });
});

// ==================== null → previous → none ====================

describe("placeholderData — returning null", () => {
    it("falls back to the previous args' data", async () => {
        const t = harness(() => null);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();
        await t.ok("A1");

        clutch.switch(2);

        expect(state().dataSource).toBe("previous");
        expect(state().data).toBe("A1");
        expect(state().dataArgs).toBe(1);
    });

    it("falls back to nothing when there is no previous data", () => {
        const t = harness(() => null);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();

        expect(state().dataSource).toBe("none");
        expect(state().data).toBeNull();
        expect(state().hasData).toBe(false);
    });
});

// ==================== Cache hit ====================

describe("placeholderData — cache hit", () => {
    it("is never called when the entry already holds data", async () => {
        const t = harness(SKELETON);

        t.resource.trigger(1);
        await t.ok("A1");
        t.placeholder.mockClear();

        const { clutch, state } = t.clutch();
        clutch.switch(1);
        clutch.start();

        expect(state().dataSource).toBe("current");
        expect(state().data).toBe("A1");
        expect(t.placeholder).not.toHaveBeenCalled();
    });

    it("is never called when the cached entry is stale and revalidating", async () => {
        const t = harness(SKELETON);

        t.resource.trigger(1);
        await t.ok("A1");
        t.resource.invalidate(1);
        t.placeholder.mockClear();

        const { clutch, state } = t.clutch();
        clutch.switch(1);
        clutch.start();

        expect(state().status).toBe("pending");
        expect(state().dataSource).toBe("current");
        expect(t.placeholder).not.toHaveBeenCalled();
    });
});

// ==================== Memo reset ====================

describe("placeholderData — memo reset", () => {
    it("switch() to new args recomputes it for the new key", () => {
        const t = harness(SKELETON);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();
        expect(state().data).toBe("ph-1");

        clutch.switch(2);

        expect(t.placeholder).toHaveBeenCalledTimes(2);
        expect(t.placeholder).toHaveBeenLastCalledWith(2, null);
        expect(state().data).toBe("ph-2");
    });

    it("switch(SKIP) drops it, so the same args recompute", () => {
        const t = harness(SKELETON);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();
        expect(t.placeholder).toHaveBeenCalledTimes(1);

        clutch.switch(SKIP);
        expect(state().status).toBe("idle");

        clutch.switch(1);

        expect(t.placeholder).toHaveBeenCalledTimes(2);
        expect(state().data).toBe("ph-1");
    });

    it("success drops it, so a later cold load of the same args recomputes", async () => {
        const t = harness(SKELETON);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();
        expect(state().dataSource).toBe("placeholder");
        expect(t.placeholder).toHaveBeenCalledTimes(1);

        // A second entry, created after the tracked one, keeps the cache
        // non-empty when the tracked entry is evicted below.
        t.resource.trigger(2);
        await t.ok("A1");
        await t.ok("A2");
        expect(state().dataSource).toBe("current");

        // Evict the tracked entry: the clutch is back to a cold load of the same
        // key, and the memo cleared on success must let the option run again.
        t.resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(state().dataSource).toBe("placeholder");
        expect(state().data).toBe("ph-1");
        expect(t.placeholder).toHaveBeenCalledTimes(2);
    });

    it("adoptPrevious does not carry the memo over", async () => {
        const t = harness(SKELETON);
        const first = t.clutch();

        first.clutch.switch(1);
        first.clutch.start();
        await t.ok("A1");

        first.clutch.switch(2);
        expect(first.state().data).toBe("ph-2");
        t.placeholder.mockClear();

        const next = t.clutch();
        next.clutch.adoptPrevious(first.clutch);
        next.clutch.switch(2, { markPending: true });

        // The successor computes its own memo — with the adopted previous data.
        expect(t.placeholder).toHaveBeenCalledTimes(1);
        expect(t.placeholder).toHaveBeenLastCalledWith(2, { data: "A1", args: 1 });
        expect(next.state().data).toBe("ph-2");
        expect(next.state().dataSource).toBe("placeholder");
    });
});

// ==================== Usage patterns from the spec ====================

describe("placeholderData — usage patterns", () => {
    it("previous outranks placeholder: `previous ? null : { data: skeleton }`", async () => {
        const t = harness((args, previous) => (previous ? null : { data: `skeleton-${args}` }));
        const { clutch, state } = t.clutch();

        // Cold start — nothing to fall back on, so the skeleton shows.
        clutch.switch(1);
        clutch.start();
        expect(state().dataSource).toBe("placeholder");
        expect(state().data).toBe("skeleton-1");

        await t.ok("A1");
        expect(state().dataSource).toBe("current");

        // Args change — previous data exists, so the option steps aside.
        clutch.switch(2);
        expect(state().dataSource).toBe("previous");
        expect(state().data).toBe("A1");
        expect(state().dataArgs).toBe(1);
    });

    it("placeholder outranks previous: partial data from elsewhere", async () => {
        const t = harness(SKELETON);
        const { clutch, state } = t.clutch();

        clutch.switch(1);
        clutch.start();
        await t.ok("A1");

        clutch.switch(2);

        // The placeholder wins over the previous args' data...
        expect(state().dataSource).toBe("placeholder");
        expect(state().data).toBe("ph-2");

        // ...but the previous entry is only hidden, not dropped: a further args
        // change without a placeholder falls back on it.
        t.setPlaceholder(() => null);
        clutch.switch(3);

        expect(state().dataSource).toBe("previous");
        expect(state().data).toBe("A1");
        expect(state().dataArgs).toBe(1);
    });
});
