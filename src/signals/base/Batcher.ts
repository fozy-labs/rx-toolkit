import { runBatch } from "./core";

export const Batcher = {
    /**
     * Runs `fn` as one batch: writes inside it mark their dependents, and the
     * effects and `.obs` deliveries they need run once, when the outermost
     * batch ends. A throwing `fn` or reaction does not stop the flush: every
     * queued reaction still runs, and the first error (`fn`'s, if it threw)
     * is rethrown afterwards. A nested run just calls `fn`.
     */
    run: runBatch as <T>(fn: () => T) => T,
};
