import { describe, expect, it } from "vitest";

import { wrapTrigger } from "@/query/lib/wrapTrigger";

// Node's `process` без подключения @types/node (тестовый tsconfig ограничен
// vitest/globals) — объявляем только то, что нужно тесту.
declare const process: {
    on(event: "unhandledRejection", cb: (reason: unknown) => void): void;
    off(event: "unhandledRejection", cb: (reason: unknown) => void): void;
};

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
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);

        try {
            wrapTrigger(Promise.reject(new Error("ignored")));

            // Unhandled rejections surface on a later tick — give them a chance.
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(unhandled).toEqual([]);
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });
});
