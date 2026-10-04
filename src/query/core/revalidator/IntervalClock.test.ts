import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stableStringify } from "@/query/lib/stableStringify";
import type { TInvalidateOnOptions } from "@/query/types";

import { Resource } from "../resource/Resource";

import { EnvironmentMonitor } from "./EnvironmentMonitor";

function createResource(interval: TInvalidateOnOptions<void, string>["interval"]) {
    const queryFn = vi.fn(async () => "loaded");
    const resource = new Resource<void, string>(
        {
            queryFn,
            retentionTime: false,
            serializeArgs: (args) => stableStringify(args),
        },
        {},
        {
            invalidateOn: { interval },
            environment: new EnvironmentMonitor(null),
        },
    );
    return { resource, queryFn };
}

describe("IntervalClock", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("arms after a run settles, revalidates on its deadline, and disposes with the entry", async () => {
        const { resource, queryFn } = createResource(10);
        const entry = resource.getEntry(undefined as void, true);
        const release = entry.hold();

        await vi.advanceTimersByTimeAsync(0);
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(9);
        expect(queryFn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(queryFn).toHaveBeenCalledTimes(2);

        resource.reset();
        expect(vi.getTimerCount()).toBe(0);
        release();
    });

    it("clears invalid intervals and isolates a throwing interval callback", async () => {
        const invalid = createResource(Number.POSITIVE_INFINITY);
        const invalidEntry = invalid.resource.getEntry(undefined as void, true);
        const releaseInvalid = invalidEntry.hold();
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);

        const onError = vi.spyOn(console, "error").mockImplementation(() => {});
        const throwing = createResource(() => {
            throw new Error("bad interval");
        });
        const throwingEntry = throwing.resource.getEntry(undefined as void, true);
        const releaseThrowing = throwingEntry.hold();
        await vi.advanceTimersByTimeAsync(0);
        expect(onError).toHaveBeenCalledWith("[Resource] invalidateOn.interval threw", expect.any(Error));
        expect(vi.getTimerCount()).toBe(0);

        invalid.resource.reset();
        throwing.resource.reset();
        releaseInvalid();
        releaseThrowing();
        onError.mockRestore();
    });
});
