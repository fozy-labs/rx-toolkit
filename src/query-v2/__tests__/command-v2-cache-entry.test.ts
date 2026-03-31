import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { CommandV2CacheEntry } from "@/query-v2/core/command/CommandV2CacheEntry";
import { ResourceV2Ref } from "@/query-v2/core/command/ResourceV2Ref";
import type {
    CommandV2Link,
    IPatchHandle,
    IResourceV2,
    IResourceV2CacheEntry,
    TCommandQueryFn,
} from "@/query-v2/types";

type TArgs = { id: number };
type TResult = { name: string };

/** Helper: creates a queryFn whose resolve/reject can be controlled externally */
function createControllableQueryFn<A = TArgs, R = TResult>() {
    let resolveFn!: (value: R) => void;
    let rejectFn!: (reason?: unknown) => void;
    const calls: Array<{ args: A; abortSignal: AbortSignal }> = [];

    const queryFn: TCommandQueryFn<A, R> = vi.fn((args: A, tools: { abortSignal: AbortSignal }) => {
        return new Promise<R>((resolve, reject) => {
            calls.push({ args, abortSignal: tools.abortSignal });
            resolveFn = resolve;
            rejectFn = reject;
        });
    });

    return {
        queryFn,
        calls,
        resolve(value: R) {
            resolveFn(value);
        },
        reject(reason?: unknown) {
            rejectFn(reason);
        },
    };
}

function createMockResource(overrides?: Partial<IResourceV2<any, any>>): IResourceV2<any, any> {
    return {
        createAgent: vi.fn() as any,
        query: vi.fn() as any,
        getEntry: vi.fn().mockReturnValue(null) as any,
        getEntry$: vi.fn() as any,
        invalidate: vi.fn(),
        ...overrides,
    };
}

function createMockEntry(overrides?: Partial<IResourceV2CacheEntry<any, any>>): IResourceV2CacheEntry<any, any> {
    return {
        createPatch: vi.fn().mockReturnValue(null),
        invalidate: vi.fn(),
        ...overrides,
    } as unknown as IResourceV2CacheEntry<any, any>;
}

describe("CommandV2CacheEntry", () => {
    // ── T30: Extends CacheEntry — peek().status === "idle" initially ──
    it("T30: starts in idle state", () => {
        const { queryFn } = createControllableQueryFn();
        const entry = new CommandV2CacheEntry({ queryFn });

        const state = entry.peek();

        expect(state.status).toBe("idle");
        expect(state.args).toBeNull();
        expect(state.data).toBeNull();
        expect(state.error).toBeNull();
    });

    // ── T31: initiate(args) calls queryFn with (args, { abortSignal }) ──
    it("T31: initiate(args) calls queryFn with args and abortSignal", () => {
        const { queryFn, calls } = createControllableQueryFn();
        const entry = new CommandV2CacheEntry({ queryFn });

        entry.initiate({ id: 1 });

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(calls[0]!.args).toEqual({ id: 1 });
        expect(calls[0]!.abortSignal).toBeInstanceOf(AbortSignal);
        expect(calls[0]!.abortSignal.aborted).toBe(false);
    });

    // ── T32: On queryFn resolve → status "success", data set ──
    it("T32: transitions to success on queryFn resolve", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        const entry = new CommandV2CacheEntry({ queryFn });

        const promise = entry.initiate({ id: 1 });
        expect(entry.peek().status).toBe("loading");

        resolve({ name: "result" });
        const result = await promise;

        expect(result).toEqual({ name: "result" });
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "result" });
    });

    // ── T33: On queryFn reject → status "error", error set ──
    it("T33: transitions to error on queryFn reject", async () => {
        const { queryFn, reject } = createControllableQueryFn();
        const entry = new CommandV2CacheEntry({ queryFn });

        const promise = entry.initiate({ id: 1 });
        expect(entry.peek().status).toBe("loading");

        const err = new Error("network failure");
        reject(err);

        await expect(promise).rejects.toBe(err);
        expect(entry.peek().status).toBe("error");
        expect(entry.peek().error).toBe(err);
    });

    // ── T34: Re-initiate aborts previous AbortController ──
    it("T34: re-initiate aborts previous AbortController", () => {
        const { queryFn, calls } = createControllableQueryFn();
        const entry = new CommandV2CacheEntry({ queryFn });

        entry.initiate({ id: 1 }).catch(() => {});
        const firstSignal = calls[0]!.abortSignal;
        expect(firstSignal.aborted).toBe(false);

        entry.initiate({ id: 2 }).catch(() => {});
        expect(firstSignal.aborted).toBe(true);
        expect(calls[1]!.abortSignal.aborted).toBe(false);
    });

    // ── T35: onQueryStarted callback fires, $queryFulfilled resolves on success ──
    it("T35: onQueryStarted fires and $queryFulfilled resolves on success", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        let capturedTools: any = null;

        const entry = new CommandV2CacheEntry({
            queryFn,
            onQueryStarted: vi.fn((args, tools) => {
                capturedTools = tools;
            }),
        });

        entry.initiate({ id: 1 });
        expect(capturedTools).not.toBeNull();
        expect(capturedTools.$queryFulfilled).toBeInstanceOf(Promise);

        resolve({ name: "done" });
        const fulfilled = await capturedTools.$queryFulfilled;

        expect(fulfilled).toEqual({ data: { name: "done" } });
    });

    // ── T36: onCacheEntryAdded callback fires, $cacheDataLoaded resolves on first success ──
    it("T36: onCacheEntryAdded fires and $cacheDataLoaded resolves on first success", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        let capturedTools: any = null;

        const entry = new CommandV2CacheEntry({
            queryFn,
            onCacheEntryAdded: vi.fn((tools) => {
                capturedTools = tools;
            }),
        });

        expect(capturedTools).not.toBeNull();
        expect(capturedTools.$cacheDataLoaded).toBeInstanceOf(Promise);
        expect(capturedTools.$cacheEntryRemoved).toBeInstanceOf(Promise);

        entry.initiate({ id: 1 });
        resolve({ name: "first" });
        await flushMicrotasks();

        const data = await capturedTools.$cacheDataLoaded;
        expect(data).toEqual({ name: "first" });
    });

    // ── T37: queryFn sync throw → status "error" ──
    it("T37: sync-throwing queryFn transitions to error", async () => {
        const syncError = new Error("sync boom");
        const queryFn = vi.fn(() => {
            throw syncError;
        }) as unknown as TCommandQueryFn<TArgs, TResult>;
        const entry = new CommandV2CacheEntry({ queryFn });

        const promise = entry.initiate({ id: 1 });

        await expect(promise).rejects.toBe(syncError);
        expect(entry.peek().status).toBe("error");
        expect(entry.peek().error).toBe(syncError);
    });

    // ── T38: Link resolution — invalidate: true calls ResourceV2Ref.invalidate() on success ──
    it("T38: linked resource is invalidated on success when invalidate: true", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        const mockResource = createMockResource();

        const link: CommandV2Link<TArgs, TResult>[] = [
            {
                resource: mockResource,
                forwardArgs: (args: TArgs) => args,
                invalidate: true,
            },
        ];

        const entry = new CommandV2CacheEntry({ queryFn, link });

        const promise = entry.initiate({ id: 1 });
        resolve({ name: "done" });
        await promise;

        expect(mockResource.invalidate).toHaveBeenCalledTimes(1);
    });

    // ── T39: Link resolution — optimisticUpdate applies patch, commits on success, aborts on error ──
    it("T39a: optimisticUpdate patch is committed on success", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        const commitFn = vi.fn();
        const abortFn = vi.fn();
        const patchHandle: IPatchHandle = { commit: commitFn, abort: abortFn };

        const mockEntry = createMockEntry({
            createPatch: vi.fn().mockReturnValue(patchHandle),
        });
        const mockResource = createMockResource({
            getEntry: vi.fn().mockReturnValue(mockEntry) as any,
        });

        const link: CommandV2Link<TArgs, TResult>[] = [
            {
                resource: mockResource,
                forwardArgs: (args: TArgs) => args,
                optimisticUpdate: ({ draft, args }) => {
                    draft.name = "optimistic";
                },
            },
        ];

        const entry = new CommandV2CacheEntry({ queryFn, link });

        const promise = entry.initiate({ id: 1 });
        // Optimistic patch applied before resolve
        expect(mockEntry.createPatch).toHaveBeenCalledTimes(1);

        resolve({ name: "final" });
        await promise;

        expect(commitFn).toHaveBeenCalledTimes(1);
        expect(abortFn).not.toHaveBeenCalled();
    });

    it("T39b: optimisticUpdate patch is aborted on error", async () => {
        const { queryFn, reject } = createControllableQueryFn();
        const commitFn = vi.fn();
        const abortFn = vi.fn();
        const patchHandle: IPatchHandle = { commit: commitFn, abort: abortFn };

        const mockEntry = createMockEntry({
            createPatch: vi.fn().mockReturnValue(patchHandle),
        });
        const mockResource = createMockResource({
            getEntry: vi.fn().mockReturnValue(mockEntry) as any,
        });

        const link: CommandV2Link<TArgs, TResult>[] = [
            {
                resource: mockResource,
                forwardArgs: (args: TArgs) => args,
                optimisticUpdate: ({ draft, args }) => {
                    draft.name = "optimistic";
                },
            },
        ];

        const entry = new CommandV2CacheEntry({ queryFn, link });

        const promise = entry.initiate({ id: 1 });
        expect(mockEntry.createPatch).toHaveBeenCalledTimes(1);

        reject(new Error("fail"));
        await promise.catch(() => {});

        expect(abortFn).toHaveBeenCalledTimes(1);
        expect(commitFn).not.toHaveBeenCalled();
    });

    // ── T40: Stale settlement after abort is ignored ──
    it("T40: stale settlement after re-initiate is ignored", async () => {
        const ctrl1 = createControllableQueryFn();
        const ctrl2 = createControllableQueryFn();

        let callCount = 0;
        const queryFn = vi.fn((args: TArgs, tools: { abortSignal: AbortSignal }) => {
            callCount++;
            if (callCount === 1) return ctrl1.queryFn(args, tools);
            return ctrl2.queryFn(args, tools);
        }) as TCommandQueryFn<TArgs, TResult>;

        const entry = new CommandV2CacheEntry({ queryFn });

        const promise1 = entry.initiate({ id: 1 }).catch(() => {});
        const promise2 = entry.initiate({ id: 2 });

        // First query was aborted, resolve it anyway — should be ignored
        ctrl1.resolve({ name: "stale" });
        await promise1;

        // Second query resolves
        ctrl2.resolve({ name: "fresh" });
        await promise2;

        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "fresh" });
        expect(entry.peek().args).toEqual({ id: 2 });
    });

    // ── resetToIdle ──
    it("resetToIdle aborts inflight and returns to idle", () => {
        const { queryFn, calls } = createControllableQueryFn();
        const entry = new CommandV2CacheEntry({ queryFn });

        entry.initiate({ id: 1 }).catch(() => {});
        expect(entry.peek().status).toBe("loading");

        entry.resetToIdle();

        expect(entry.peek().status).toBe("idle");
        expect(calls[0]!.abortSignal.aborted).toBe(true);
    });

    // ── complete() cleanup ──
    it("complete() aborts inflight and cleans up", () => {
        const { queryFn, calls } = createControllableQueryFn();
        const entry = new CommandV2CacheEntry({ queryFn });

        entry.initiate({ id: 1 }).catch(() => {});
        entry.complete();

        expect(calls[0]!.abortSignal.aborted).toBe(true);
    });

    // ── T36b: $cacheEntryRemoved resolves on complete() ──
    it("T36b: $cacheEntryRemoved resolves when entry is completed", async () => {
        const { queryFn } = createControllableQueryFn();
        let removedPromise: Promise<void> | null = null;
        let dataLoadedPromise: Promise<TResult> | null = null;

        const entry = new CommandV2CacheEntry({
            queryFn,
            onCacheEntryAdded: (tools) => {
                removedPromise = tools.$cacheEntryRemoved;
                dataLoadedPromise = tools.$cacheDataLoaded;
            },
        });

        expect(removedPromise).not.toBeNull();
        // Suppress unhandled rejection on $cacheDataLoaded
        dataLoadedPromise!.catch(() => {});

        entry.complete();

        // Should resolve (not reject)
        await expect(removedPromise!).resolves.toBeUndefined();
    });

    // ── T35b: $queryFulfilled rejects on error ──
    it("T35b: $queryFulfilled rejects when queryFn fails", async () => {
        const { queryFn, reject } = createControllableQueryFn();
        let capturedTools: any = null;

        const entry = new CommandV2CacheEntry({
            queryFn,
            onQueryStarted: vi.fn((args, tools) => {
                capturedTools = tools;
            }),
        });

        const promise = entry.initiate({ id: 1 });
        const err = new Error("fail");
        reject(err);

        // Suppress unhandled rejection on the trigger promise
        await promise.catch(() => {});
        await expect(capturedTools.$queryFulfilled).rejects.toBe(err);
    });

    // ── Link update patches ──
    it("T38b: link update patches applied on success", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        const commitFn = vi.fn();
        const abortFn = vi.fn();
        const patchHandle: IPatchHandle = { commit: commitFn, abort: abortFn };

        const mockEntry = createMockEntry({
            createPatch: vi.fn().mockReturnValue(patchHandle),
        });
        const mockResource = createMockResource({
            getEntry: vi.fn().mockReturnValue(mockEntry) as any,
        });

        const link: CommandV2Link<TArgs, TResult>[] = [
            {
                resource: mockResource,
                forwardArgs: (args: TArgs) => args,
                update: ({ draft, args, data }) => {
                    draft.name = data.name;
                },
            },
        ];

        const entry = new CommandV2CacheEntry({ queryFn, link });

        const promise = entry.initiate({ id: 1 });
        resolve({ name: "updated" });
        await promise;

        // Update patch should be created and committed
        expect(mockEntry.createPatch).toHaveBeenCalledTimes(1);
        expect(commitFn).toHaveBeenCalledTimes(1);
    });
});
