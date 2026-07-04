// Node's `process` without pulling in @types/node (the test tsconfig is
// limited to vitest/globals) — declare only what the helper needs.
declare const process: {
    on(event: "unhandledRejection", cb: (reason: unknown) => void): void;
    off(event: "unhandledRejection", cb: (reason: unknown) => void): void;
};

/**
 * Track global unhandled rejections for the duration of a test.
 * Call `stop()` in a `finally` block to detach the listener.
 *
 * Node emits `unhandledRejection` at the end of macrotask turns, so
 * notifications queued by earlier tests are drained first — the tracker only
 * captures rejections produced after it was installed.
 */
export async function trackUnhandledRejections(): Promise<{ readonly unhandled: readonly unknown[]; stop(): void }> {
    await flushUnhandledRejections();

    const unhandled: unknown[] = [];
    const handler = (reason: unknown) => {
        unhandled.push(reason);
    };
    process.on("unhandledRejection", handler);
    return {
        unhandled,
        stop: () => process.off("unhandledRejection", handler),
    };
}

/**
 * Unhandled rejections surface on later macrotasks — wait long enough for
 * Node to emit them before asserting.
 */
export async function flushUnhandledRejections(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}
