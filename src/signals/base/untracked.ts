import { DependencyTracker } from "./DependencyTracker";

/**
 * Runs `fn` outside the calling dependency-tracking scope: signals it reads do
 * not become dependencies of the `Computed` / `Effect` that is running now.
 *
 * Internal on purpose — kept out of the `base` barrel, which reaches the root
 * export. For code that runs user callbacks as a side effect of an action or
 * of a subscription (a query run, a retention hook), where those reads belong
 * to nobody.
 */
export function untracked<T>(fn: () => T): T {
    const stopTracking = DependencyTracker.start(null);
    try {
        return fn();
    } finally {
        stopTracking();
    }
}
