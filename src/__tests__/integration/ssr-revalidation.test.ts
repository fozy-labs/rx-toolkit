// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createApi } from "@/query/api/createApi";
import { browserEnvironmentDriver } from "@/query/lib/browserEnvironmentDriver";

describe("SSR automatic revalidation", () => {
    it("reports hidden without browser globals and does not arm interval timers", async () => {
        expect(typeof window).toBe("undefined");
        expect(typeof document).toBe("undefined");
        expect(browserEnvironmentDriver().connect(vi.fn())).toEqual({
            visible: false,
            focused: false,
            online: true,
        });

        vi.useFakeTimers();
        try {
            const api = createApi({
                invalidateOn: { interval: 10 },
                environmentDriver: browserEnvironmentDriver(),
            });
            const queryFn = vi.fn(async () => "loaded");
            const resource = api.createResource({ queryFn, retentionTime: false });
            const entry = resource.getEntry(undefined as void, true);
            const release = entry.hold();

            await Promise.resolve();
            await Promise.resolve();

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
            release();
        } finally {
            vi.useRealTimers();
        }
    });
});
