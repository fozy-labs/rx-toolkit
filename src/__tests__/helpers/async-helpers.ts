/**
 * Wait for all scheduled microtasks to complete.
 */
export function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}
