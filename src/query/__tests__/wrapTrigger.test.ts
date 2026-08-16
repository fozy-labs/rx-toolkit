import { describe, expect, it } from "vitest";

import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { wrapTrigger } from "@/query/lib/wrapTrigger";

describe("wrapTrigger", () => {
    it("resolves with a success envelope", async () => {
        const wrapped = wrapTrigger(Promise.resolve("data"));

        await expect(wrapped).resolves.toEqual({ status: "success", data: "data" });
    });

    it("resolves with an error envelope instead of rejecting", async () => {
        const err = new Error("boom");
        const wrapped = wrapTrigger(Promise.reject(err));

        const result = await wrapped;
        expect(result.status).toBe("error");
        expect(result.error).toBe(err);
        expect(result.data).toBeUndefined();
    });

    it("unwrap() returns the raw promise contract", async () => {
        await expect(wrapTrigger(Promise.resolve(42)).unwrap()).resolves.toBe(42);

        const err = new Error("boom");
        await expect(wrapTrigger(Promise.reject(err)).unwrap()).rejects.toBe(err);
    });

    it("attaches rejection handling synchronously (no unhandled rejection when ignored)", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            wrapTrigger(Promise.reject(new Error("ignored")));

            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });
});
