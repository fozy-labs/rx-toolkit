import { Observable, of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/constants";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IEnvironmentDriver, TEnvironmentState } from "@/query/types";

function environment(initial: Partial<TEnvironmentState> = {}) {
    let current: TEnvironmentState = { visible: true, focused: true, online: true, ...initial };
    let onChange: ((state: TEnvironmentState) => void) | null = null;
    const driver: IEnvironmentDriver = {
        connect: vi.fn((callback) => {
            onChange = callback;
            return { ...current };
        }),
        disconnect: vi.fn(),
    };

    return {
        driver,
        set(next: Partial<TEnvironmentState>) {
            current = { ...current, ...next };
            onChange?.({ ...current });
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function loadAndHold<TArgs, TEntry extends { hold(): () => void }>(
    resource: { getEntry(args: TArgs, doInitiate: true): TEntry },
    args: TArgs,
) {
    const entry = resource.getEntry(args, true);
    const release = entry.hold();
    await flushMicrotasks();
    return { entry, release };
}

describe("automatic resource revalidation", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("merges API defaults per key, honors false and explicit undefined, and stays disconnected when disabled", async () => {
        const env = environment();
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { focus: true, reconnect: true },
        });
        const inheritedFn = vi.fn(async () => "inherited");
        const inherited = api.createResource({ queryFn: inheritedFn, retentionTime: false });
        const inheritedEntry = await loadAndHold(inherited, undefined);
        env.set({ focused: false });
        env.set({ focused: true });
        expect(inheritedFn).toHaveBeenCalledTimes(2);

        const disabledFn = vi.fn(async () => "disabled");
        const disabled = api.createResource({
            queryFn: disabledFn,
            invalidateOn: false,
            retentionTime: false,
        });
        const disabledEntry = await loadAndHold(disabled, undefined);
        env.set({ focused: false });
        env.set({ focused: true });
        expect(disabledFn).toHaveBeenCalledTimes(1);

        const partialFn = vi.fn(async () => "partial");
        const partial = api.createResource({
            queryFn: partialFn,
            invalidateOn: { focus: false },
            retentionTime: false,
        });
        const partialEntry = await loadAndHold(partial, undefined);
        env.set({ online: false });
        env.set({ online: true });
        expect(partialFn).toHaveBeenCalledTimes(2);

        const undefinedFn = vi.fn(async () => "undefined inherits");
        const explicitUndefined = api.createResource({
            queryFn: undefinedFn,
            invalidateOn: { focus: undefined },
            retentionTime: false,
        });
        const undefinedEntry = await loadAndHold(explicitUndefined, undefined);
        env.set({ focused: false });
        env.set({ focused: true });
        expect(undefinedFn).toHaveBeenCalledTimes(2);

        expect(env.driver.connect).toHaveBeenCalledTimes(1);
        inheritedEntry.release();
        disabledEntry.release();
        partialEntry.release();
        undefinedEntry.release();

        const offDriver = environment();
        const offApi = createApi({
            environmentDriver: offDriver.driver,
            invalidateOn: { focus: false, reconnect: false, interval: false },
        });
        offApi.createResource({ queryFn: async () => "off" });
        const plainApi = createApi({ environmentDriver: offDriver.driver });
        plainApi.createResource({ queryFn: async () => "plain" });
        expect(offDriver.driver.connect).not.toHaveBeenCalled();
    });

    it("keeps data visible while focus revalidation runs and deduplicates simultaneous environment changes", async () => {
        const env = environment();
        const second = deferred<string>();
        const queryFn = vi.fn<() => Promise<string>>().mockResolvedValueOnce("old").mockReturnValueOnce(second.promise);
        const api = createApi({ environmentDriver: env.driver, invalidateOn: { focus: true } });
        const resource = api.createResource({ queryFn, retentionTime: false });
        const { release } = await loadAndHold(resource, undefined);

        env.set({ visible: false, focused: false });
        env.set({ visible: true, focused: true });
        env.set({ visible: true, focused: true });

        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(resource.getState(undefined as void)).toMatchObject({
            data: "old",
            dataSource: "current",
            isInvalidating: true,
            updatedAt: 0,
        });
        second.resolve("fresh");
        await flushMicrotasks();
        expect(resource.getState(undefined as void)).toMatchObject({ data: "fresh", status: "success" });
        release();
        api.resetAll();
    });

    it("coalesces simultaneous focus and reconnect for synchronous query functions", async () => {
        const env = environment({ focused: false, online: false });
        const queryFn = vi.fn(() => of("data"));
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { focus: true, reconnect: true },
        });
        const resource = api.createResource({ queryFn, retentionTime: false });
        const { release } = await loadAndHold(resource, undefined);

        expect(queryFn).toHaveBeenCalledTimes(1);
        env.set({ focused: true, online: true });
        await flushMicrotasks();

        expect(queryFn).toHaveBeenCalledTimes(2);
        release();
        api.resetAll();
    });

    it("fires once when only reconnect meets its threshold in a combined report", async () => {
        const env = environment({ online: false });
        const queryFn = vi.fn(() => of("data"));
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { focus: true, reconnect: true },
        });
        const resource = api.createResource({
            queryFn,
            invalidateOn: { focus: 100, reconnect: 100 },
            retentionTime: false,
        });
        const { release } = await loadAndHold(resource, undefined);

        await vi.advanceTimersByTimeAsync(25);
        env.set({ focused: false });
        await vi.advanceTimersByTimeAsync(75);
        env.set({ focused: true, online: true });
        await flushMicrotasks();

        expect(queryFn).toHaveBeenCalledTimes(2);
        release();
        api.resetAll();
    });

    it("does not fire when neither threshold matches a combined report", async () => {
        const env = environment({ online: false });
        const queryFn = vi.fn(() => of("data"));
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { focus: true, reconnect: true },
        });
        const resource = api.createResource({
            queryFn,
            invalidateOn: { focus: 100, reconnect: 100 },
            retentionTime: false,
        });
        const { release } = await loadAndHold(resource, undefined);

        await vi.advanceTimersByTimeAsync(25);
        env.set({ focused: false });
        await vi.advanceTimersByTimeAsync(50);
        env.set({ focused: true, online: true });
        await flushMicrotasks();

        expect(queryFn).toHaveBeenCalledTimes(1);
        release();
        api.resetAll();
    });

    it("applies focus and reconnect away-time thresholds", async () => {
        const env = environment();
        const queryFn = vi.fn(async () => "data");
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { focus: true, reconnect: true },
        });
        const resource = api.createResource({
            queryFn,
            invalidateOn: { focus: 100, reconnect: 100 },
            retentionTime: false,
        });
        const { release } = await loadAndHold(resource, undefined);

        env.set({ focused: false });
        await vi.advanceTimersByTimeAsync(99);
        env.set({ focused: true });
        expect(queryFn).toHaveBeenCalledTimes(1);

        env.set({ focused: false });
        await vi.advanceTimersByTimeAsync(100);
        env.set({ focused: true });
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(2);

        env.set({ online: false });
        await vi.advanceTimersByTimeAsync(50);
        env.set({ online: true });
        expect(queryFn).toHaveBeenCalledTimes(2);

        env.set({ online: false });
        await vi.advanceTimersByTimeAsync(100);
        env.set({ online: true });
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(3);
        release();
    });

    it("normalizes negative, infinite, NaN and unsupported away thresholds", async () => {
        const env = environment();
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { focus: true, reconnect: true, interval: 1_000 },
        });
        const negativeFn = vi.fn(async () => "negative");
        const negative = api.createResource({
            queryFn: negativeFn,
            invalidateOn: { focus: -1 },
            retentionTime: false,
        });
        const negativeEntry = await loadAndHold(negative, undefined);
        const infiniteFn = vi.fn(async () => "infinite");
        const infinite = api.createResource({
            queryFn: infiniteFn,
            invalidateOn: { focus: false, reconnect: Number.POSITIVE_INFINITY },
            retentionTime: false,
        });
        const infiniteEntry = await loadAndHold(infinite, undefined);
        const nanFn = vi.fn(async () => "nan");
        const nan = api.createResource({
            queryFn: nanFn,
            invalidateOn: { focus: Number.NaN, reconnect: false },
            retentionTime: false,
        });
        const nanEntry = await loadAndHold(nan, undefined);
        const unsupportedFn = vi.fn(async () => "unsupported");
        const unsupported = api.createResource({
            queryFn: unsupportedFn,
            invalidateOn: { focus: "enabled" as never, reconnect: false },
            retentionTime: false,
        });
        const unsupportedEntry = await loadAndHold(unsupported, undefined);

        env.set({ focused: false });
        env.set({ focused: true });
        await flushMicrotasks();
        expect(negativeFn).toHaveBeenCalledTimes(2);
        expect(nanFn).toHaveBeenCalledTimes(1);
        expect(unsupportedFn).toHaveBeenCalledTimes(1);

        env.set({ online: false });
        await vi.advanceTimersByTimeAsync(10);
        env.set({ online: true });
        await flushMicrotasks();
        expect(infiniteFn).toHaveBeenCalledTimes(1);

        negativeEntry.release();
        infiniteEntry.release();
        nanEntry.release();
        unsupportedEntry.release();
    });

    it("evaluates policy functions per entry with args and updatedAt-bearing state", async () => {
        const env = environment();
        const focus = vi.fn((args: { id: number }, state: { updatedAt: number | null }) =>
            args.id === 1 && state.updatedAt !== null ? 0 : Number.POSITIVE_INFINITY,
        );
        const reconnect = vi.fn((args: { id: number }, state: { updatedAt: number | null }) =>
            args.id === 2 && state.updatedAt !== null ? true : false,
        );
        const queryFn = vi.fn(async ({ id }: { id: number }) => ({ id }));
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { focus: true, reconnect: 100 },
        });
        const resource = api.createResource({
            queryFn,
            invalidateOn: { focus, reconnect, interval: (_args, state) => (state.updatedAt === null ? false : false) },
            retentionTime: false,
        });
        const first = await loadAndHold(resource, { id: 1 });
        const second = await loadAndHold(resource, { id: 2 });

        env.set({ focused: false });
        env.set({ focused: true });
        env.set({ online: false });
        env.set({ online: true });
        await flushMicrotasks();

        expect(focus).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({ updatedAt: expect.any(Number) }));
        expect(focus).toHaveBeenCalledWith({ id: 2 }, expect.objectContaining({ updatedAt: expect.any(Number) }));
        expect(reconnect).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({ updatedAt: expect.any(Number) }));
        expect(reconnect).toHaveBeenCalledWith({ id: 2 }, expect.objectContaining({ updatedAt: expect.any(Number) }));
        expect(queryFn).toHaveBeenCalledTimes(4);
        first.release();
        second.release();
    });

    it("logs a throwing focus policy and continues with other entries", async () => {
        const env = environment();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const queryFn = vi.fn(async ({ id }: { id: number }) => ({ id }));
        const resource = createApi({ environmentDriver: env.driver }).createResource({
            queryFn,
            invalidateOn: {
                focus: ({ id }) => {
                    if (id === 1) throw new Error("focus policy");
                    return true;
                },
            },
            retentionTime: false,
        });
        const first = await loadAndHold(resource, { id: 1 });
        const second = await loadAndHold(resource, { id: 2 });

        env.set({ focused: false });
        env.set({ focused: true });
        await flushMicrotasks();

        expect(error).toHaveBeenCalledWith("[Resource] invalidateOn.focus threw", expect.any(Error));
        expect(queryFn).toHaveBeenCalledTimes(3);
        first.release();
        second.release();
    });

    it("marks a melting entry on focus and revalidates on its next hold", async () => {
        const env = environment();
        const queryFn = vi.fn(async () => "data");
        const api = createApi({ environmentDriver: env.driver, invalidateOn: { focus: true } });
        const resource = api.createResource({ queryFn, retentionTime: false });
        const entry = resource.getEntry(undefined as void, true);
        await flushMicrotasks();

        env.set({ focused: false });
        env.set({ focused: true });
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(true);

        const release = entry.hold();
        expect(queryFn).toHaveBeenCalledTimes(2);
        release();
    });

    it("uses retry for both error rows while preserving the error during the run", async () => {
        const env = environment();
        const retryLoad = deferred<string>();
        const firstQuery = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error("initial"))
            .mockReturnValueOnce(retryLoad.promise);
        const api = createApi({ environmentDriver: env.driver, invalidateOn: { focus: true } });
        const failed = api.createResource({ queryFn: firstQuery, retentionTime: false });
        const first = await loadAndHold(failed, undefined);
        expect(failed.getState(undefined as void)).toMatchObject({ status: "error", hasError: true });

        env.set({ focused: false });
        env.set({ focused: true });
        expect(firstQuery).toHaveBeenCalledTimes(2);
        expect(failed.getState(undefined as void)).toMatchObject({ status: "pending", hasError: true });
        retryLoad.resolve("retried");
        await flushMicrotasks();

        const invalidateLoad = deferred<string>();
        const invalidateQuery = vi
            .fn<() => Promise<string>>()
            .mockResolvedValueOnce("stale")
            .mockRejectedValueOnce(new Error("refresh"))
            .mockReturnValueOnce(invalidateLoad.promise);
        const invalidated = api.createResource({ queryFn: invalidateQuery, retentionTime: false });
        const second = await loadAndHold(invalidated, undefined);
        invalidated.invalidate(undefined as void);
        await flushMicrotasks();
        expect(invalidated.getState(undefined as void)).toMatchObject({
            status: "error",
            dataSource: "current",
            hasError: true,
        });

        env.set({ focused: false });
        env.set({ focused: true });
        expect(invalidateQuery).toHaveBeenCalledTimes(3);
        expect(invalidated.getState(undefined as void)).toMatchObject({
            status: "pending",
            data: "stale",
            hasError: true,
        });
        invalidateLoad.resolve("fresh");
        await flushMicrotasks();
        first.release();
        second.release();
    });

    it("joins an in-flight run and preserves an explicit trailing policy", async () => {
        const env = environment();
        const firstRun = deferred<string>();
        const trailingRun = deferred<string>();
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockReturnValueOnce(firstRun.promise)
            .mockReturnValueOnce(trailingRun.promise);
        const api = createApi({ environmentDriver: env.driver, invalidateOn: { focus: true } });
        const resource = api.createResource({ queryFn, retentionTime: false });
        const entry = resource.getEntry(undefined as void, true);
        const release = entry.hold();

        env.set({ focused: false });
        env.set({ focused: true });
        expect(queryFn).toHaveBeenCalledTimes(1);
        entry.invalidate({ inFlight: "trail" });
        env.set({ focused: false });
        env.set({ focused: true });
        firstRun.resolve("first");
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(2);
        trailingRun.resolve("trailing");
        await flushMicrotasks();
        expect(resource.getState(undefined as void)).toMatchObject({ data: "trailing", status: "success" });
        release();
    });

    it("runs intervals after settle, avoids overlap, and resets the deadline after manual invalidation", async () => {
        const slow = deferred<string>();
        const queryFn = vi
            .fn<() => Promise<string>>(async () => "fallback")
            .mockResolvedValueOnce("one")
            .mockReturnValueOnce(slow.promise)
            .mockResolvedValueOnce("three")
            .mockResolvedValueOnce("four");
        const api = createApi({ environmentDriver: null });
        const resource = api.createResource({
            queryFn,
            invalidateOn: { interval: 20 },
            retentionTime: false,
        });
        const { release } = await loadAndHold(resource, undefined);

        await vi.advanceTimersByTimeAsync(20);
        expect(queryFn).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(60);
        expect(queryFn).toHaveBeenCalledTimes(2);
        slow.resolve("two");
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(19);
        expect(queryFn).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(queryFn).toHaveBeenCalledTimes(3);

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(10);
        resource.invalidate(undefined as void);
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(19);
        expect(queryFn).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(1);
        expect(queryFn).toHaveBeenCalledTimes(5);
        release();
    });

    it("pauses while melting, hidden or offline and asynchronously catches up when eligible", async () => {
        const env = environment();
        const queryFn = vi.fn(async () => "data");
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { interval: 20 },
        });
        const resource = api.createResource({ queryFn, retentionTime: false });
        const { entry, release } = await loadAndHold(resource, undefined);
        release();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(30);
        expect(queryFn).toHaveBeenCalledTimes(1);

        const rehold = entry.hold();
        await vi.advanceTimersByTimeAsync(0);
        expect(queryFn).toHaveBeenCalledTimes(2);
        await flushMicrotasks();

        env.set({ visible: false });
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(30);
        env.set({ visible: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(queryFn).toHaveBeenCalledTimes(3);
        await flushMicrotasks();

        env.set({ online: false });
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(30);
        env.set({ online: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(queryFn).toHaveBeenCalledTimes(4);
        rehold();
    });

    it("re-evaluates functional intervals, stops on false, logs throws, and ignores invalid periods", async () => {
        const queryFn = vi.fn(async () => ({ done: queryFn.mock.calls.length > 1 }));
        const resource = createApi({ environmentDriver: null }).createResource({
            queryFn,
            invalidateOn: { interval: (_args, state) => (state.hasData && state.data.done ? false : 10) },
            retentionTime: false,
        });
        const { release } = await loadAndHold(resource, undefined);
        await vi.advanceTimersByTimeAsync(10);
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(50);
        expect(queryFn).toHaveBeenCalledTimes(2);
        release();

        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const throwing = createApi({ environmentDriver: null }).createResource({
            queryFn: vi.fn(async () => "data"),
            invalidateOn: {
                interval: () => {
                    throw new Error("interval");
                },
            },
            retentionTime: false,
        });
        const thrown = await loadAndHold(throwing, undefined);
        expect(error).toHaveBeenCalledWith("[Resource] invalidateOn.interval threw", expect.any(Error));
        expect(vi.getTimerCount()).toBe(0);
        thrown.release();
        error.mockRestore();

        for (const interval of [false, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648] as const) {
            const invalid = createApi({ environmentDriver: null }).createResource({
                queryFn: vi.fn(async () => "data"),
                invalidateOn: { interval },
                retentionTime: false,
            });
            const item = await loadAndHold(invalid, undefined);
            expect(vi.getTimerCount()).toBe(0);
            item.release();
        }
    });

    it("retries interval errors, clears timers on eviction and reset, and never polls open streams", async () => {
        const retry = deferred<string>();
        const queryFn = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error("failed"))
            .mockReturnValueOnce(retry.promise);
        const api = createApi({ environmentDriver: null });
        const resource = api.createResource({
            queryFn,
            invalidateOn: { interval: 10 },
            retentionTime: false,
        });
        const { release } = await loadAndHold(resource, undefined);
        expect(resource.getState(undefined as void)).toMatchObject({ status: "error" });
        await vi.advanceTimersByTimeAsync(10);
        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(resource.getState(undefined as void)).toMatchObject({ status: "pending", hasError: true });
        retry.resolve("ok");
        await flushMicrotasks();
        release();
        (resource as typeof resource & { reset(): void }).reset();
        expect(vi.getTimerCount()).toBe(0);

        const streamApi = createApi({ environmentDriver: null });
        const streamQuery = vi.fn(() => new Observable<string>(() => {}));
        const stream = streamApi.createResource({
            queryFn: streamQuery,
            invalidateOn: { interval: 10 },
            retentionTime: false,
        });
        const streamEntry = stream.getEntry(undefined as void, true);
        const streamRelease = streamEntry.hold();
        await vi.advanceTimersByTimeAsync(100);
        expect(streamQuery).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        streamEntry.complete();
        streamRelease();

        const resetApi = createApi({ environmentDriver: null });
        const resetResource = resetApi.createResource({
            queryFn: async () => "data",
            invalidateOn: { interval: 50 },
            retentionTime: false,
        });
        const resetEntry = await loadAndHold(resetResource, undefined);
        expect(vi.getTimerCount()).toBe(1);
        resetApi.resetAll();
        expect(vi.getTimerCount()).toBe(0);
        resetEntry.release();

        const evictionApi = createApi({ environmentDriver: null, resourceRetentionTime: 5 });
        const evictionResource = evictionApi.createResource({
            queryFn: async () => "data",
            invalidateOn: { interval: 50 },
        });
        const evicted = await loadAndHold(evictionResource, undefined);
        evicted.release();
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(5);
        expect(evictionResource.getEntry(undefined as void)).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps null-driver intervals active and does not revalidate projections from API defaults", async () => {
        const nullApi = createApi({
            environmentDriver: null,
            invalidateOn: { focus: true, interval: 10 },
        });
        const nullQuery = vi.fn(async () => "data");
        const nullResource = nullApi.createResource({ queryFn: nullQuery, retentionTime: false });
        const nullEntry = await loadAndHold(nullResource, undefined);
        await vi.advanceTimersByTimeAsync(10);
        expect(nullQuery).toHaveBeenCalledTimes(2);
        nullEntry.release();

        const env = environment();
        const api = createApi({
            environmentDriver: env.driver,
            invalidateOn: { focus: true, interval: 10 },
        });
        const wrappedFn = vi.fn(async (ids: number[]) =>
            ids.map((id) => ({ id, name: `user-${wrappedFn.mock.calls.length}` })),
        );
        const wrapped = api.createResource({
            queryFn: wrappedFn,
            invalidateOn: false,
            retentionTime: false,
        });
        const projection = api.unstable_createProjectionResource({
            resource: wrapped,
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids: number[]) => ids,
            retentionTime: false,
        });
        const projected = projection.getEntry([1], true);
        const release = projected.hold();
        await projected.whenFetched();
        const projectionData = projection.getState([1]).data;
        expect(projection.getState([1]).dataSource).toBe("current");
        expect(projectionData).not.toBeNull();
        expect(await wrapped.fetch([1])).toEqual([{ id: 1, name: "user-2" }]);
        expect(wrappedFn).toHaveBeenCalledTimes(2);
        expect(projection.getState([1]).data).toEqual(projectionData);
        await vi.advanceTimersByTimeAsync(30);
        expect(env.driver.connect).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(wrappedFn).toHaveBeenCalledTimes(2);
        release();
    });

    it("propagates updatedAt through current, previous, placeholder and hydrated state rows", async () => {
        const api = createApi({ environmentDriver: null });
        const previousRun = deferred<string>();
        const previousQuery = vi.fn((id: number) => (id === 1 ? Promise.resolve("previous") : previousRun.promise));
        const resource = api.createResource({ queryFn: previousQuery, retentionTime: false });
        const clutch = resource.createClutch();
        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ data: "previous", updatedAt: 0 });

        vi.setSystemTime(100);
        clutch.switch(2);
        expect(clutch.state$()).toMatchObject({
            data: "previous",
            dataArgs: 1,
            dataSource: "previous",
            updatedAt: 0,
            args: 2,
        });

        const placeholderRun = deferred<string>();
        let previousShape: string[] | null = null;
        const placeholderResource = api.createResource({
            queryFn: (id: number) => (id === 1 ? Promise.resolve("first") : placeholderRun.promise),
            placeholderData: (_args, previous) => {
                previousShape = previous ? Object.keys(previous) : null;
                return { data: "placeholder" };
            },
            retentionTime: false,
        });
        const placeholderClutch = placeholderResource.createClutch();
        placeholderClutch.switch(1);
        placeholderClutch.start();
        await flushMicrotasks();
        placeholderClutch.switch(2);
        expect(placeholderClutch.state$()).toMatchObject({
            data: "placeholder",
            dataSource: "placeholder",
            updatedAt: null,
        });
        expect(previousShape).toEqual(["data", "args"]);

        const snapshotApi = createApi({
            environmentDriver: null,
            invalidateOn: { interval: 10 },
            snapshotValidTime: Number.POSITIVE_INFINITY,
            initialSnapshot: {
                version: CURRENT_SNAPSHOT_VERSION,
                keyPrefix: null,
                timestamp: 0,
                resources: {
                    cached: {
                        entries: {
                            [stableStringify(4)]: {
                                status: "success",
                                args: 4,
                                data: "snapshot",
                                updatedAt: 123,
                            },
                        },
                    },
                },
            },
        });
        const hydratedQueryFn = vi.fn(async (_args: number) => "fresh");
        const hydrated = snapshotApi.createResource({
            key: "cached",
            queryFn: hydratedQueryFn,
            retentionTime: false,
        });
        expect(hydrated.getState(4)).toMatchObject({ data: "snapshot", updatedAt: 123 });
        const hydratedEntry = hydrated.getEntry(4, true);
        const releaseHydrated = hydratedEntry.hold();
        await vi.advanceTimersByTimeAsync(10);
        await flushMicrotasks();
        expect(hydratedQueryFn).toHaveBeenCalledTimes(1);
        releaseHydrated();

        previousRun.resolve("second");
        placeholderRun.resolve("second");
        await flushMicrotasks();
    });
});
