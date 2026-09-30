import type { SubscriptionLike } from "rxjs";

import { EffectNode } from "../base/core";

type Teardown = () => void;
type EffectFn = () => void | Teardown;

/**
 * Runs `effectFn` now and again whenever a signal it read changes, after the
 * batch that changed it. A function it returns is the teardown: called
 * before the next run and on `unsubscribe()`.
 *
 * - A first run that throws disposes the effect and rethrows.
 * - A later run that throws keeps the effect subscribed to what it read
 *   before the throw; the error surfaces from the write that triggered it.
 * - A write of the running body to a signal it read directly does not re-run
 *   it; one that changes a computed it read does, except in the first run.
 */
export class Effect implements SubscriptionLike {
    private readonly _node: EffectNode;
    closed = false;

    constructor(effectFn: EffectFn) {
        this._node = new EffectNode(effectFn);
    }

    unsubscribe(): void {
        this.closed = true;
        this._node.unsubscribe();
    }

    static create(effectFn: EffectFn) {
        return new Effect(effectFn);
    }
}
