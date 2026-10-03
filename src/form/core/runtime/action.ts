import { Batcher } from "@/signals/base/Batcher";
import { untracked } from "@/signals/base/untracked";

/**
 * Wraps a node action: it runs untracked, so an effect or a computation that calls it gains no
 * dependencies from what it reads, and as one batch, so its writes notify once.
 */
export function action<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args) => untracked(() => Batcher.run(() => fn(...args)));
}
